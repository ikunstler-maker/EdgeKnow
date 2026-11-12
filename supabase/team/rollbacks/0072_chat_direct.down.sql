-- Undo 0072_chat_direct.
drop function public.chat_set_member_history(uuid, uuid, boolean);
drop function public.chat_set_history_visible(uuid, boolean);
drop function public.chat_open_direct(uuid, uuid[]);
drop function public.chat_add_members(uuid, uuid[], boolean);
create function public.chat_add_members(ch uuid, user_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  person uuid;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) or public.is_guest(c.workspace_id, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  if cardinality(coalesce(user_ids, '{}')) not between 1 and 200 then
    return public.ws_error('invalid_people');
  end if;
  foreach person in array user_ids loop
    if not public.is_active_member(c.workspace_id, person) then
      return public.ws_error('not_found');
    end if;
    if public.is_guest(c.workspace_id, person) and not public.chat_can_manage(ch) then
      return public.ws_error('forbidden');
    end if;
    if not public.chat_category_open(c.category_id, person) then
      return public.ws_error('no_category_access');
    end if;
  end loop;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited, added_by)
  select distinct ch, c.workspace_id, u.id, true, auth.uid() from unnest(user_ids) u(id)
  on conflict (channel_id, user_id) do update set invited = true, added_by = excluded.added_by;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.chat_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.chat_add_members(uuid, uuid[]) to authenticated;

create or replace function public.chat_my_channels(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.category_position nulls first, x.position, x.name), '[]'::jsonb) from (
    select c.id, c.name, c.topic, c.kind, c.visibility, c.category_id, c.unit_id, c.position, c.archived_at,
           k.position as category_position,
           (m.user_id is not null or c.visibility = 'closed') as joined,
           m.role, coalesce(m.notify, 'all') as notify, m.last_read_at,
           case when m.user_id is not null or c.visibility = 'closed' then (
             select count(*) from (select 1 from public.chat_messages msg
               where msg.channel_id = c.id and msg.deleted_at is null and msg.author_id is distinct from auth.uid()
                 and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz) limit 100) u)
           else 0 end as unread,
           case when m.user_id is not null or c.visibility = 'closed' then exists (
             select 1 from public.chat_messages msg
             where msg.channel_id = c.id and msg.deleted_at is null and auth.uid() = any (msg.mentions)
               and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz))
           else false end as mentioned
    from public.chat_channels c
    left join public.chat_categories k on k.id = c.category_id
    left join public.chat_channel_members m on m.channel_id = c.id and m.user_id = auth.uid()
    where c.workspace_id = ws and public.is_workspace_member(ws) and public.chat_can_see(c.id, auth.uid())
  ) x;
$$;

create or replace function public.chat_post_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[])
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
  if not found or not public.chat_can_read(ch) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  if char_length(clean) not between 1 and 4000 then
    return public.ws_error('invalid_body');
  end if;
  if thread_root is not null and not exists (
    select 1 from public.chat_messages r where r.id = thread_root and r.channel_id = ch and r.thread_root_id is null and r.deleted_at is null) then
    return public.ws_error('not_found');
  end if;
  if (select count(*) from public.chat_messages m where m.author_id = auth.uid() and m.created_at > now() - interval '1 minute') >= 30 then
    return public.ws_error('rate_limited');
  end if;
  insert into public.chat_messages (workspace_id, channel_id, author_id, thread_root_id, body, mentions)
  values (c.workspace_id, ch, auth.uid(), thread_root, clean, public.chat_clean_mentions(ch, mention_ids))
  returning id into made;
  if thread_root is not null then
    update public.chat_messages set reply_count = reply_count + 1, last_reply_at = now() where id = thread_root;
  end if;
  update public.chat_channel_members set last_read_at = now() where channel_id = ch and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

create or replace function public.chat_update_channel(ch uuid, new_name text, new_topic text, new_category uuid, new_unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_manage(ch) then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;
  if char_length(coalesce(new_topic, '')) > 250 then
    return public.ws_error('invalid_topic');
  end if;
  if new_category is not null and not exists (select 1 from public.chat_categories k where k.id = new_category and k.workspace_id = c.workspace_id) then
    return public.ws_error('not_found');
  end if;
  if new_category is distinct from c.category_id and not public.chat_category_open(new_category, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if new_unit is not null and (c.visibility <> 'closed'
     or not exists (select 1 from public.workspace_groups g where g.id = new_unit and g.workspace_id = c.workspace_id)) then
    return public.ws_error('invalid_unit');
  end if;
  if c.archived_at is null and exists (select 1 from public.chat_channels o where o.workspace_id = c.workspace_id and o.id <> ch
       and o.archived_at is null and lower(btrim(o.name)) = lower(btrim(new_name))) then
    return public.ws_error('name_taken');
  end if;
  update public.chat_channels set name = btrim(new_name), topic = btrim(coalesce(new_topic, '')), category_id = new_category,
    unit_id = new_unit, updated_at = now()
  where id = ch;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.chat_toggle_reaction(msg uuid, reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = msg;
  if not found or m.deleted_at is not null or not public.chat_can_read(m.channel_id)
     or (select c.archived_at from public.chat_channels c where c.id = m.channel_id) is not null then
    return public.ws_error('forbidden');
  end if;
  if reaction is null or char_length(reaction) not between 1 and 16 or reaction ~ '[\x00-\x7F]' then
    return public.ws_error('invalid_reaction');
  end if;
  delete from public.chat_reactions where message_id = msg and user_id = auth.uid() and emoji = reaction;
  if found then
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  if (select count(distinct r.emoji) from public.chat_reactions r where r.message_id = msg) >= 20
     and not exists (select 1 from public.chat_reactions r where r.message_id = msg and r.emoji = reaction) then
    return public.ws_error('too_many');
  end if;
  insert into public.chat_reactions (message_id, workspace_id, channel_id, user_id, emoji)
  values (msg, m.workspace_id, m.channel_id, auth.uid(), reaction);
  return jsonb_build_object('ok', true, 'on', true);
end;
$$;

create or replace function public.chat_pin_message(msg uuid, pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = msg;
  if not found or m.deleted_at is not null or not public.chat_can_read(m.channel_id)
     or (select c.archived_at from public.chat_channels c where c.id = m.channel_id) is not null then
    return public.ws_error('forbidden');
  end if;
  if coalesce(pinned, true) then
    if m.pinned_at is null and (select count(*) from public.chat_messages p where p.channel_id = m.channel_id and p.pinned_at is not null) >= 50 then
      return public.ws_error('too_many');
    end if;
    update public.chat_messages set pinned_at = coalesce(pinned_at, now()), pinned_by = coalesce(pinned_by, auth.uid()) where id = msg;
  else
    update public.chat_messages set pinned_at = null, pinned_by = null where id = msg;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.chat_edit_message(msg uuid, new_body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
  clean text := btrim(coalesce(new_body, ''));
begin
  select * into m from public.chat_messages where id = msg;
  if not found or m.author_id is distinct from auth.uid() or m.deleted_at is not null or not public.chat_can_read(m.channel_id) then
    return public.ws_error('forbidden');
  end if;
  if (select c.archived_at from public.chat_channels c where c.id = m.channel_id) is not null then
    return public.ws_error('archived');
  end if;
  if char_length(clean) not between 1 and 4000 then
    return public.ws_error('invalid_body');
  end if;
  update public.chat_messages set body = clean, mentions = public.chat_clean_mentions(m.channel_id, mention_ids), edited_at = now()
  where id = msg;
  return jsonb_build_object('ok', true);
end;
$$;

drop policy "Messages of the channels the person sees" on public.chat_messages;
create policy "Messages of the channels the person sees" on public.chat_messages
  for select to authenticated using (public.chat_can_read(channel_id));
drop policy "Reactions in the channels the person sees" on public.chat_reactions;
create policy "Reactions in the channels the person sees" on public.chat_reactions
  for select to authenticated using (public.chat_can_read(channel_id));
drop function public.chat_message_history_ok(uuid);
drop function public.chat_history_ok(uuid, timestamptz);
revoke select (history_from) on public.chat_channel_members from authenticated;
alter table public.chat_channel_members drop column history_from;
delete from public.chat_channels where visibility = 'direct';
drop index public.chat_channels_name_idx;
create unique index chat_channels_name_idx on public.chat_channels (workspace_id, lower(btrim(name))) where archived_at is null;
drop index public.chat_channels_dm_key_idx;
alter table public.chat_channels
  drop constraint chat_channels_dm_key_check,
  drop constraint chat_channels_direct_check,
  drop column dm_key,
  drop column history_visible,
  drop constraint chat_channels_name_check,
  add constraint chat_channels_name_check check (char_length(btrim(name)) between 1 and 80),
  drop constraint chat_channels_visibility_check,
  add constraint chat_channels_visibility_check check (visibility in ('open', 'closed'));
