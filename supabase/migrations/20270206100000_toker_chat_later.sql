-- The same in supabase/team/migrations/0079_toker_chat_later.sql.
-- Rollback: supabase/rollbacks/20270206100000_toker_chat_later.down.sql

-- Toker, stage 2c: search in chat and messages sent later (decision 2026-11-12
-- "Toker, етап 2"). Drafts stay on the device (no table).

-- Search: messages (and replies) the signed-in person sees in a workspace — or in one
-- channel — whose text contains the words; newest first, at most 50.
create function public.chat_search(ws uuid, query text, ch uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select '%' || replace(replace(replace(left(btrim(coalesce(query, '')), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           char_length(btrim(coalesce(query, ''))) >= 2 as enough
  ),
  seen as (
    select c.id, c.name, c.visibility from public.chat_channels c
    where c.workspace_id = ws and (ch is null or c.id = ch) and public.is_workspace_member(ws) and public.chat_can_see(c.id, auth.uid())
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.channel_id, s.name as channel, s.visibility, m.thread_root_id, m.author_id, m.created_at, left(m.body, 300) as body
    from public.chat_messages m
    join seen s on s.id = m.channel_id
    cross join ctx
    where ctx.enough and m.workspace_id = ws and m.deleted_at is null and m.body ilike ctx.pattern
      and public.chat_history_ok(m.channel_id, m.created_at)
    order by m.created_at desc
    limit 50
  ) x;
$$;

-- Messages to be sent later: only their author sees them, until they go.
create table public.chat_scheduled (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  channel_id      uuid not null references public.chat_channels (id) on delete cascade,
  author_id       uuid not null references public.profiles (id) on delete cascade,
  thread_root_id  uuid references public.chat_messages (id) on delete cascade,
  body            text not null check (char_length(btrim(body)) between 1 and 4000),
  mentions        uuid[] not null default '{}' check (cardinality(mentions) <= 50),
  send_at         timestamptz not null,
  created_at      timestamptz not null default now()
);
create index chat_scheduled_due_idx on public.chat_scheduled (workspace_id, send_at);
create index chat_scheduled_author_idx on public.chat_scheduled (author_id, send_at);

create function public.check_chat_scheduled_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select c.workspace_id from public.chat_channels c where c.id = new.channel_id)
     or (new.thread_root_id is not null and not exists (
       select 1 from public.chat_messages r where r.id = new.thread_root_id and r.channel_id = new.channel_id and r.thread_root_id is null)) then
    raise exception 'chat_workspace_mismatch';
  end if;
  return new;
end;
$$;
create trigger chat_scheduled_workspace before insert or update on public.chat_scheduled
  for each row execute function public.check_chat_scheduled_workspace();
revoke execute on function public.check_chat_scheduled_workspace() from public, anon, authenticated;

alter table public.chat_scheduled enable row level security;
revoke all on public.chat_scheduled from public, anon, authenticated;
grant select on public.chat_scheduled to authenticated;
create policy "One's own messages to be sent later" on public.chat_scheduled
  for select to authenticated using (author_id = auth.uid() and public.is_workspace_member(workspace_id));

-- Plan a message (or a reply) for later: between a minute and a year ahead, up to 50 per person.
create function public.chat_schedule_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[], at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  made uuid;
  clean text := btrim(coalesce(new_body, ''));
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) or c.archived_at is not null then
    return public.ws_error('forbidden');
  end if;
  if thread_root is null and not public.chat_can_publish(ch) then
    return public.ws_error('publish_forbidden');
  end if;
  if char_length(clean) not between 1 and 4000 then
    return public.ws_error('invalid_body');
  end if;
  if at is null or at < now() + interval '1 minute' or at > now() + interval '1 year' then
    return public.ws_error('invalid_time');
  end if;
  if thread_root is not null and not exists (
    select 1 from public.chat_messages r where r.id = thread_root and r.channel_id = ch and r.thread_root_id is null and r.deleted_at is null
      and public.chat_history_ok(ch, r.created_at)) then
    return public.ws_error('not_found');
  end if;
  if (select count(*) from public.chat_scheduled s where s.author_id = auth.uid()) >= 50 then
    return public.ws_error('too_many');
  end if;
  insert into public.chat_scheduled (workspace_id, channel_id, author_id, thread_root_id, body, mentions, send_at)
  values (c.workspace_id, ch, auth.uid(), thread_root, clean, public.chat_clean_mentions(ch, mention_ids), at)
  returning id into made;
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

create function public.chat_cancel_scheduled(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chat_scheduled where id = target and author_id = auth.uid();
  if not found then
    return public.ws_error('not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Sends what is due in a workspace, each as its author — if the author still may write
-- there (sees the channel, may publish top messages, the thread still there);
-- otherwise it is dropped. Called by anyone of the workspace with the bell's check, so
-- the delay is that of the nearest open page. Each one goes once (taken by delete).
create function public.chat_send_due(ws uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.chat_scheduled;
  c public.chat_channels;
  sent integer := 0;
  made uuid;
begin
  if not public.is_workspace_member(ws) then
    return 0;
  end if;
  for s in
    delete from public.chat_scheduled d
    where d.id in (select x.id from public.chat_scheduled x where x.workspace_id = ws and x.send_at <= now() order by x.send_at limit 100 for update skip locked)
    returning d.*
  loop
    select * into c from public.chat_channels where id = s.channel_id;
    continue when c.archived_at is not null or not public.chat_can_see(s.channel_id, s.author_id);
    continue when s.thread_root_id is null and c.post_policy = 'chosen'
      and not public.chat_is_admin(ws, s.author_id)
      and not exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = s.author_id and (m.can_post or (m.role = 'owner' and m.invited)));
    continue when s.thread_root_id is not null and not exists (select 1 from public.chat_messages r where r.id = s.thread_root_id and r.deleted_at is null);
    insert into public.chat_messages (workspace_id, channel_id, author_id, thread_root_id, body, mentions, created_at)
    values (ws, s.channel_id, s.author_id, s.thread_root_id, s.body, public.chat_clean_mentions(s.channel_id, s.mentions), now())
    returning id into made;
    if s.thread_root_id is not null then
      update public.chat_messages set reply_count = reply_count + 1, last_reply_at = now() where id = s.thread_root_id;
    end if;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke execute on function public.chat_search(uuid, text, uuid), public.chat_schedule_message(uuid, text, uuid, uuid[], timestamptz),
  public.chat_cancel_scheduled(uuid), public.chat_send_due(uuid) from public, anon;
grant execute on function public.chat_search(uuid, text, uuid), public.chat_schedule_message(uuid, text, uuid, uuid[], timestamptz),
  public.chat_cancel_scheduled(uuid), public.chat_send_due(uuid) to authenticated;
