-- The same in supabase/team/migrations/0072_chat_direct.sql.
-- Rollback: supabase/rollbacks/20270128100000_chat_direct.down.sql

-- Toker, stage 2a: conversations of two and group conversations, and what earlier
-- history people added later see (decision 2026-11-12 "Toker, етап 2").
-- A conversation is a channel of its own kind ("direct"): no name, category or unit;
-- only its people see it (admins too only when in it). A conversation of two is one per
-- pair. Group conversations take up to 8 people. A channel or group says whether people
-- added later see the earlier history; whoever adds someone may choose otherwise for
-- them. Without it the database hides the earlier messages, their reactions and files.

alter table public.chat_channels
  drop constraint chat_channels_visibility_check,
  add constraint chat_channels_visibility_check check (visibility in ('open', 'closed', 'direct')),
  drop constraint chat_channels_name_check,
  add constraint chat_channels_name_check check (char_length(btrim(name)) between 1 and 80 or (visibility = 'direct' and char_length(name) <= 80)),
  add column history_visible boolean not null default true,
  add column dm_key text,
  add constraint chat_channels_direct_check check (visibility <> 'direct' or (category_id is null and unit_id is null)),
  add constraint chat_channels_dm_key_check check (dm_key is null or visibility = 'direct');
create unique index chat_channels_dm_key_idx on public.chat_channels (workspace_id, dm_key) where dm_key is not null;
drop index public.chat_channels_name_idx;
create unique index chat_channels_name_idx on public.chat_channels (workspace_id, lower(btrim(name))) where archived_at is null and visibility <> 'direct';

-- From when the person sees the channel's messages (null: all of them).
alter table public.chat_channel_members add column history_from timestamptz;
-- Shown with the channel's people (whoever manages it offers the history to those without).
grant select (history_from) on public.chat_channel_members to authenticated;

-- May the signed-in person see a message of this time in this channel (the earlier
-- history hidden from them)? Seeing the channel itself is checked separately.
create function public.chat_history_ok(ch uuid, created timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.chat_channel_members m
                     where m.channel_id = ch and m.user_id = auth.uid() and m.history_from > created);
$$;

create function public.chat_message_history_ok(msg uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.chat_history_ok(m.channel_id, m.created_at) from public.chat_messages m where m.id = msg), false);
$$;
revoke execute on function public.chat_history_ok(uuid, timestamptz), public.chat_message_history_ok(uuid) from public, anon;
grant execute on function public.chat_history_ok(uuid, timestamptz), public.chat_message_history_ok(uuid) to authenticated;

drop policy "Messages of the channels the person sees" on public.chat_messages;
create policy "Messages of the channels the person sees" on public.chat_messages
  for select to authenticated using (public.chat_can_read(channel_id) and public.chat_history_ok(channel_id, created_at));
drop policy "Reactions in the channels the person sees" on public.chat_reactions;
create policy "Reactions in the channels the person sees" on public.chat_reactions
  for select to authenticated using (public.chat_can_read(channel_id) and public.chat_message_history_ok(message_id));

-- Open a conversation with people (1 to 7 others): with one person, the pair's
-- conversation (made the first time); with more, a new group conversation.
-- Members may write to anyone in the workspace; a guest only to people they see.
create function public.chat_open_direct(ws uuid, people uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  others uuid[];
  key text;
  found_id uuid;
  made uuid;
  person uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.ws_error('forbidden');
  end if;
  select coalesce(array_agg(distinct p.id), '{}') into others from unnest(coalesce(people, '{}')) p(id) where p.id is not null and p.id <> auth.uid();
  if cardinality(others) not between 1 and 7 then
    return public.ws_error('invalid_people');
  end if;
  foreach person in array others loop
    if not public.is_active_member(ws, person) or (guest and not public.guest_sees(ws, person)) then
      return public.ws_error('not_found');
    end if;
  end loop;
  if cardinality(others) = 1 then
    key := least(auth.uid()::text, others[1]::text) || ':' || greatest(auth.uid()::text, others[1]::text);
    select c.id into found_id from public.chat_channels c where c.workspace_id = ws and c.dm_key = key;
    if found_id is not null then
      -- Someone who left the pair's conversation comes back to it.
      insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited, added_by)
      values (found_id, ws, auth.uid(), true, auth.uid())
      on conflict (channel_id, user_id) do update set invited = true;
      return jsonb_build_object('ok', true, 'id', found_id);
    end if;
  end if;
  if (select count(*) from public.chat_channels c where c.workspace_id = ws) >= 20000 then
    return public.ws_error('too_many');
  end if;
  insert into public.chat_channels (workspace_id, name, visibility, dm_key, created_by)
  values (ws, '', 'direct', key, auth.uid())
  returning id into made;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, role, invited, added_by)
  select made, ws, p.id, case when p.id = auth.uid() and key is null then 'owner' else 'member' end, true, auth.uid()
  from unnest(others || auth.uid()) p(id);
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

-- Whether people added later see the earlier history (who manages the channel or group).
create function public.chat_set_history_visible(ch uuid, visible boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_manage(ch) or exists (select 1 from public.chat_channels c where c.id = ch and (c.visibility = 'open' or c.dm_key is not null)) then
    return public.ws_error('forbidden');
  end if;
  update public.chat_channels set history_visible = coalesce(visible, true), updated_at = now() where id = ch;
  return jsonb_build_object('ok', true);
end;
$$;

-- Show (or hide again) the earlier history to someone already added (who manages it).
create function public.chat_set_member_history(ch uuid, person uuid, show boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_manage(ch) then
    return public.ws_error('forbidden');
  end if;
  update public.chat_channel_members set history_from = case when coalesce(show, true) then null else joined_at end
  where channel_id = ch and user_id = person and invited;
  if not found then
    return public.ws_error('not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

drop function public.chat_add_members(uuid, uuid[]);
create function public.chat_add_members(ch uuid, user_ids uuid[], show_history boolean default null)
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
  if c.dm_key is not null then
    return public.ws_error('direct_pair');
  end if;
  if c.visibility = 'direct' and (select count(*) from public.chat_channel_members m where m.channel_id = ch and m.invited)
       + (select count(*) from unnest(user_ids) u(id) where not exists (select 1 from public.chat_channel_members m where m.channel_id = ch and m.user_id = u.id and m.invited)) > 8 then
    return public.ws_error('too_many');
  end if;
  if cardinality(coalesce(user_ids, '{}')) not between 1 and 200 then
    return public.ws_error('invalid_people');
  end if;
  foreach person in array user_ids loop
    if not public.is_active_member(c.workspace_id, person) then
      return public.ws_error('not_found');
    end if;
    if public.is_guest(c.workspace_id, person) and not public.chat_can_manage(ch) and c.visibility <> 'direct' then
      return public.ws_error('forbidden');
    end if;
    if not public.chat_category_open(c.category_id, person) then
      return public.ws_error('no_category_access');
    end if;
  end loop;
  -- Earlier history: as the channel says, unless the person adding chose for these people.
  -- Someone already in keeps what they had.
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited, added_by, history_from)
  select distinct ch, c.workspace_id, u.id, true, auth.uid(), case when coalesce(show_history, c.history_visible) then null else now() end
  from unnest(user_ids) u(id)
  on conflict (channel_id, user_id) do update set
    history_from = case when public.chat_channel_members.invited then public.chat_channel_members.history_from else excluded.history_from end,
    invited = true, added_by = excluded.added_by;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.chat_my_channels(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.category_position nulls first, x.position, x.name), '[]'::jsonb) from (
    select c.id, c.name, c.topic, c.kind, c.visibility, c.category_id, c.unit_id, c.position, c.archived_at,
           k.position as category_position, c.history_visible,
           -- A conversation is named by its people (the others first).
           case when c.visibility = 'direct' then (
             select coalesce(jsonb_agg(p.user_id order by p.user_id = auth.uid(), p.joined_at), '[]'::jsonb)
             from public.chat_channel_members p where p.channel_id = c.id and p.invited) end as people,
           (m.user_id is not null or c.visibility in ('closed', 'direct')) as joined,
           m.role, coalesce(m.notify, 'all') as notify, m.last_read_at,
           case when m.user_id is not null or c.visibility in ('closed', 'direct') then (
             select count(*) from (select 1 from public.chat_messages msg
               where msg.channel_id = c.id and msg.deleted_at is null and msg.author_id is distinct from auth.uid()
                 and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz) and msg.created_at >= coalesce(m.history_from, '-infinity'::timestamptz) limit 100) u)
           else 0 end as unread,
           case when m.user_id is not null or c.visibility in ('closed', 'direct') then exists (
             select 1 from public.chat_messages msg
             where msg.channel_id = c.id and msg.deleted_at is null and auth.uid() = any (msg.mentions)
               and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz) and msg.created_at >= coalesce(m.history_from, '-infinity'::timestamptz))
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
    select 1 from public.chat_messages r where r.id = thread_root and r.channel_id = ch and r.thread_root_id is null and r.deleted_at is null
      and public.chat_history_ok(ch, r.created_at)) then
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
  if not found or not public.chat_can_manage(ch) or c.visibility = 'direct' then
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
  if not found or m.deleted_at is not null or not public.chat_can_read(m.channel_id) or not public.chat_history_ok(m.channel_id, m.created_at)
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
  if not found or m.deleted_at is not null or not public.chat_can_read(m.channel_id) or not public.chat_history_ok(m.channel_id, m.created_at)
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
  if not found or m.author_id is distinct from auth.uid() or m.deleted_at is not null or not public.chat_can_read(m.channel_id) or not public.chat_history_ok(m.channel_id, m.created_at) then
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

revoke execute on function public.chat_open_direct(uuid, uuid[]), public.chat_set_history_visible(uuid, boolean),
  public.chat_set_member_history(uuid, uuid, boolean), public.chat_add_members(uuid, uuid[], boolean) from public, anon;
grant execute on function public.chat_open_direct(uuid, uuid[]), public.chat_set_history_visible(uuid, boolean),
  public.chat_set_member_history(uuid, uuid, boolean), public.chat_add_members(uuid, uuid[], boolean) to authenticated;
