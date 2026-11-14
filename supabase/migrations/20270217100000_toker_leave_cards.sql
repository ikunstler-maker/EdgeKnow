-- TOKER-6 Toker, stage 3c-2: a time-off request as a system message with approval buttons.
-- Rollback: supabase/rollbacks/20270217100000_toker_leave_cards.down.sql
-- The same in supabase/team/migrations/0091_toker_leave_cards.sql.
--
-- When someone asks for time off that waits for a decision, the database writes a
-- system message into the direct conversation of the requester with each person the
-- request goes to (the same people Doba notifies), creating it when needed. The
-- message keeps only the request's id: the chat shows the request as each reader may
-- see it (leave_requests' own rules), and the decision goes through
-- decide_leave_request, so the rights stay those of Doba. Nobody can write, edit or
-- delete a system message; a change of the request's status signals the message.

alter table public.chat_messages
  add column kind text not null default 'user' check (kind in ('user', 'system')),
  add column leave_request_id uuid references public.leave_requests (id) on delete set null,
  drop constraint chat_messages_check,
  add constraint chat_messages_check check (deleted_at is not null or char_length(btrim(body)) >= 1 or file_count > 0 or kind = 'system');
create index chat_messages_leave_idx on public.chat_messages (leave_request_id) where leave_request_id is not null;

-- A system message stays as written: no edits, no deletion, no turning a message into one.
create function public.chat_system_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or (old.kind = 'system' and (new.body is distinct from old.body or new.mentions is distinct from old.mentions
                                  or new.deleted_at is distinct from old.deleted_at or new.file_count is distinct from old.file_count
                                  or (new.leave_request_id is distinct from old.leave_request_id and new.leave_request_id is not null))) then
    raise exception 'system_message';
  end if;
  return new;
end;
$$;
revoke execute on function public.chat_system_guard() from public, anon, authenticated;
create trigger chat_messages_system_guard before update on public.chat_messages
  for each row execute function public.chat_system_guard();

-- The direct conversation of two people (made when there is none; both brought back if
-- one left it). Null when the workspace has no room for another channel.
create function public.chat_direct_between(ws uuid, one uuid, other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := least(one::text, other::text) || ':' || greatest(one::text, other::text);
  found_id uuid;
begin
  select c.id into found_id from public.chat_channels c where c.workspace_id = ws and c.dm_key = key;
  if found_id is null then
    if (select count(*) from public.chat_channels c where c.workspace_id = ws) >= 20000 then
      return null;
    end if;
    insert into public.chat_channels (workspace_id, name, visibility, dm_key, created_by)
    values (ws, '', 'direct', key, one)
    returning id into found_id;
  end if;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, role, invited, added_by)
  values (found_id, ws, one, 'member', true, one), (found_id, ws, other, 'member', true, one)
  on conflict (channel_id, user_id) do update set invited = true;
  return found_id;
end;
$$;
revoke execute on function public.chat_direct_between(uuid, uuid, uuid) from public, anon, authenticated;

-- A new request waiting for a decision: a card in each decider's conversation with the
-- requester. Only for the person's own request (request_leave), so copying data between
-- databases writes no new messages.
create function public.chat_leave_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nearest integer;
  person uuid;
  ch uuid;
begin
  if new.status <> 'pending' or new.user_id is distinct from auth.uid() or public.is_guest(new.workspace_id, new.user_id) then
    return null;
  end if;
  select min(l.level) into nearest from public.leave_leads_of(new.workspace_id, new.user_id) l;
  for person in
    select distinct d.user_id from (
      select l.user_id from public.leave_leads_of(new.workspace_id, new.user_id) l where nearest is not null and l.level = nearest
      union all
      select m.user_id from public.workspace_members m
      where nearest is null and m.workspace_id = new.workspace_id and m.status = 'active' and public.leave_manager(new.workspace_id, m.user_id)
    ) d
  loop
    continue when person = new.user_id or not public.is_active_member(new.workspace_id, person) or public.is_guest(new.workspace_id, person);
    ch := public.chat_direct_between(new.workspace_id, new.user_id, person);
    continue when ch is null;
    -- The real moment (not the transaction's), so it counts as unread for a member just added.
    insert into public.chat_messages (workspace_id, channel_id, author_id, body, kind, leave_request_id, created_at)
    values (new.workspace_id, ch, new.user_id, '', 'system', new.id, clock_timestamp());
  end loop;
  return null;
end;
$$;
revoke execute on function public.chat_leave_post() from public, anon, authenticated;
create trigger leave_requests_chat_post after insert on public.leave_requests
  for each row execute function public.chat_leave_post();

-- A decision or a cancellation: the cards are signalled (the screens read the request again).
create function public.chat_leave_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_messages set reply_count = reply_count where leave_request_id = new.id;
  return null;
end;
$$;
revoke execute on function public.chat_leave_touch() from public, anon, authenticated;
create trigger leave_requests_chat_touch after update of status on public.leave_requests
  for each row when (old.status is distinct from new.status) execute function public.chat_leave_touch();
