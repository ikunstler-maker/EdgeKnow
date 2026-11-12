-- Toker in a team's own database (as supabase/migrations/20270123100000_chat.sql;
-- roles are saved centrally and copied here, people move with the central function).
-- Rollback: supabase/team/rollbacks/0068_chat.down.sql

-- Toker (team chat), stage 1a: categories, channels, members, messages, threads,
-- reactions (decisions 2026-11-12 "Toker: architecture and stages" and "Toker, stage 1:
-- tables and access rules").
-- Reading goes through row level security; every change goes through the functions
-- below (the browser never writes these tables). Who sees a channel:
--   * the category first: a restricted category is open only to its units (the unit,
--     the units under it, the leads of the units above — as everywhere), its people
--     named one by one, and the workspace's owner and admins;
--   * then the channel: an open channel — every member who is not a guest; a closed
--     channel — the people added to it, and, when it belongs to a unit, that unit's
--     people. Admins see a closed channel only when they are in it. Guests see only
--     the channels they were added to, never through a unit.
-- Live updates: the database sends a short signal ("something changed in channel X")
-- to private realtime topics that only the people who see the channel may join; the
-- browser then reads the rows through the same rules. No text goes through the signal.

-- Categories (folders of channels in the left panel).
create table public.chat_categories (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  position      integer not null default 0,
  restricted    boolean not null default false,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index chat_categories_ws_idx on public.chat_categories (workspace_id, position);

-- Who a restricted category is open to: units and people.
create table public.chat_category_access (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  category_id   uuid not null references public.chat_categories (id) on delete cascade,
  group_id      uuid references public.workspace_groups (id) on delete cascade,
  user_id       uuid references public.profiles (id) on delete cascade,
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now(),
  check ((group_id is null) <> (user_id is null))
);
create unique index chat_category_access_group_idx on public.chat_category_access (category_id, group_id) where group_id is not null;
create unique index chat_category_access_user_idx on public.chat_category_access (category_id, user_id) where user_id is not null;
create index chat_category_access_ws_idx on public.chat_category_access (workspace_id);

create table public.chat_channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  category_id   uuid references public.chat_categories (id),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  topic         text not null default '' check (char_length(topic) <= 250),
  kind          text not null default 'text' check (kind in ('text', 'forum', 'voice')),
  visibility    text not null check (visibility in ('open', 'closed')),
  unit_id       uuid references public.workspace_groups (id) on delete set null,
  position      integer not null default 0,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  archived_by   uuid references public.profiles (id) on delete set null,
  check (visibility = 'closed' or unit_id is null)
);
create unique index chat_channels_name_idx on public.chat_channels (workspace_id, lower(btrim(name))) where archived_at is null;
create index chat_channels_category_idx on public.chat_channels (category_id);
create index chat_channels_unit_idx on public.chat_channels (unit_id) where unit_id is not null;

-- A row per person in a channel: added to it ("invited": what gives access to a closed
-- channel or to a guest), joined an open channel, or reached a unit channel and keeps
-- the read mark there. Only "invited" rows give access.
create table public.chat_channel_members (
  channel_id    uuid not null references public.chat_channels (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  invited       boolean not null default false,
  notify        text not null default 'all' check (notify in ('all', 'mentions', 'none')),
  last_read_at  timestamptz not null default now(),
  added_by      uuid references public.profiles (id) on delete set null,
  joined_at     timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index chat_channel_members_user_idx on public.chat_channel_members (user_id, workspace_id);

-- Messages and thread replies (one level: a reply's thread_root_id is a top message).
create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  channel_id      uuid not null references public.chat_channels (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  thread_root_id  uuid references public.chat_messages (id) on delete cascade,
  body            text not null check (char_length(body) <= 4000),
  mentions        uuid[] not null default '{}' check (cardinality(mentions) <= 50),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null,
  pinned_at       timestamptz,
  pinned_by       uuid references public.profiles (id) on delete set null,
  reply_count     integer not null default 0,
  last_reply_at   timestamptz,
  check (deleted_at is not null or char_length(btrim(body)) >= 1)
);
create index chat_messages_channel_idx on public.chat_messages (channel_id, created_at) where thread_root_id is null;
create index chat_messages_thread_idx on public.chat_messages (thread_root_id, created_at) where thread_root_id is not null;
create index chat_messages_author_idx on public.chat_messages (author_id, created_at);
create index chat_messages_pinned_idx on public.chat_messages (channel_id) where pinned_at is not null;
create index chat_messages_ws_idx on public.chat_messages (workspace_id, created_at);

create table public.chat_reactions (
  message_id    uuid not null references public.chat_messages (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  channel_id    uuid not null references public.chat_channels (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  emoji         text not null check (char_length(emoji) between 1 and 16 and emoji !~ '[\x00-\x7F]'),
  created_at    timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index chat_reactions_channel_idx on public.chat_reactions (channel_id);

-- A row's workspace must be its parent's (a channel's category, a member's channel...).
create function public.check_chat_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_ws uuid;
begin
  if tg_table_name = 'chat_channels' then
    if new.category_id is not null then
      select c.workspace_id into parent_ws from public.chat_categories c where c.id = new.category_id;
      if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    end if;
    if new.unit_id is not null then
      select g.workspace_id into parent_ws from public.workspace_groups g where g.id = new.unit_id;
      if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    end if;
  elsif tg_table_name = 'chat_category_access' then
    select c.workspace_id into parent_ws from public.chat_categories c where c.id = new.category_id;
    if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    if new.group_id is not null then
      select g.workspace_id into parent_ws from public.workspace_groups g where g.id = new.group_id;
      if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    end if;
  elsif tg_table_name = 'chat_messages' then
    select c.workspace_id into parent_ws from public.chat_channels c where c.id = new.channel_id;
    if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    if new.thread_root_id is not null and not exists (
      select 1 from public.chat_messages r where r.id = new.thread_root_id and r.channel_id = new.channel_id and r.thread_root_id is null) then
      raise exception 'chat_thread_mismatch';
    end if;
  else
    -- chat_channel_members, chat_reactions
    select c.workspace_id into parent_ws from public.chat_channels c where c.id = new.channel_id;
    if parent_ws is distinct from new.workspace_id then raise exception 'chat_workspace_mismatch'; end if;
    if tg_table_name = 'chat_reactions' then
      if not exists (select 1 from public.chat_messages m where m.id = (to_jsonb(new) ->> 'message_id')::uuid and m.channel_id = new.channel_id) then
        raise exception 'chat_workspace_mismatch';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger chat_channels_workspace before insert or update of workspace_id, category_id, unit_id on public.chat_channels
  for each row execute function public.check_chat_workspace();
create trigger chat_category_access_workspace before insert or update on public.chat_category_access
  for each row execute function public.check_chat_workspace();
create trigger chat_channel_members_workspace before insert or update of workspace_id, channel_id on public.chat_channel_members
  for each row execute function public.check_chat_workspace();
create trigger chat_messages_workspace before insert or update of workspace_id, channel_id, thread_root_id on public.chat_messages
  for each row execute function public.check_chat_workspace();
create trigger chat_reactions_workspace before insert or update on public.chat_reactions
  for each row execute function public.check_chat_workspace();

-- Owner or admin of the workspace (active).
create function public.chat_is_admin(ws uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = member and m.status = 'active' and m.role in ('owner', 'admin'));
$$;

-- Is a category open to this person? (No category, or one for everyone: yes.)
create function public.chat_category_open(cat uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cat is null or exists (
    select 1 from public.chat_categories c
    where c.id = cat and (
      not c.restricted
      or public.chat_is_admin(c.workspace_id, member)
      or exists (select 1 from public.chat_category_access a where a.category_id = c.id and a.user_id = member)
      or (not public.is_guest(c.workspace_id, member)
          and exists (select 1 from public.chat_category_access a
                      where a.category_id = c.id and a.group_id is not null and public.unit_reaches(a.group_id, member)))
    )
  );
$$;

-- Does this person (an active member; a guest within the access dates) see the channel?
create function public.chat_can_see(ch uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select member is not null and exists (
    select 1 from public.chat_channels c
    where c.id = ch
      and public.is_active_member(c.workspace_id, member)
      and public.chat_category_open(c.category_id, member)
      and (
        exists (select 1 from public.chat_channel_members cm where cm.channel_id = c.id and cm.user_id = member and cm.invited)
        or (c.visibility = 'open' and not public.is_guest(c.workspace_id, member))
        or (c.visibility = 'closed' and c.unit_id is not null and not public.is_guest(c.workspace_id, member)
            and public.unit_reaches(c.unit_id, member))
      )
  );
$$;

-- The signed-in person, through every check of the workspace (domain, frozen workspace).
create function public.chat_can_read(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member((select c.workspace_id from public.chat_channels c where c.id = ch))
    and public.chat_can_see(ch, auth.uid());
$$;

-- May the signed-in person manage the channel (rename, archive, people, delete
-- messages of others)? Its owners and the workspace's owner and admins — only while
-- they see it.
create function public.chat_can_manage(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.chat_can_read(ch) and (
    exists (select 1 from public.chat_channel_members cm where cm.channel_id = ch and cm.user_id = auth.uid() and cm.role = 'owner' and cm.invited)
    or public.chat_is_admin((select c.workspace_id from public.chat_channels c where c.id = ch), auth.uid())
  );
$$;

-- May the signed-in person join a realtime topic? "chat:<channel>" — who sees the
-- channel; "chat-user:<own id>" — oneself.
create function public.chat_topic_allowed(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.chat_can_read(substr(topic, 6)::uuid);
  end if;
  return auth.uid() is not null and topic = 'chat-user:' || auth.uid()::text;
end;
$$;

revoke execute on function public.check_chat_workspace(), public.chat_is_admin(uuid, uuid),
  public.chat_category_open(uuid, uuid), public.chat_can_see(uuid, uuid)
from public, anon, authenticated;
-- For the rules on categories: the signed-in person.
create function public.chat_category_visible(cat uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_categories k
    where k.id = cat and public.is_workspace_member(k.workspace_id) and public.chat_category_open(k.id, auth.uid())
      and (not public.is_guest(k.workspace_id, auth.uid())
           or exists (select 1 from public.chat_channels c where c.category_id = k.id and public.chat_can_see(c.id, auth.uid())))
  );
$$;

create function public.chat_admin_of(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and public.chat_is_admin(ws, auth.uid());
$$;

revoke execute on function public.chat_can_read(uuid), public.chat_can_manage(uuid), public.chat_topic_allowed(text),
  public.chat_category_visible(uuid), public.chat_admin_of(uuid) from public, anon;
grant execute on function public.chat_can_read(uuid), public.chat_can_manage(uuid), public.chat_topic_allowed(text),
  public.chat_category_visible(uuid), public.chat_admin_of(uuid) to authenticated;

-- Reading. Read marks and notification levels of others stay hidden (column rights):
-- one's own come through chat_my_channels.
alter table public.chat_categories enable row level security;
alter table public.chat_category_access enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;
revoke all on public.chat_categories, public.chat_category_access, public.chat_channels, public.chat_channel_members,
  public.chat_messages, public.chat_reactions from public, anon, authenticated;
grant select on public.chat_categories, public.chat_category_access, public.chat_channels, public.chat_messages, public.chat_reactions to authenticated;
grant select (channel_id, workspace_id, user_id, role, invited, joined_at) on public.chat_channel_members to authenticated;

create policy "Categories open to the person (guests: with their channels)" on public.chat_categories
  for select to authenticated
  using (public.chat_category_visible(id));
create policy "Owner and admins see who a category is open to" on public.chat_category_access
  for select to authenticated
  using (public.chat_admin_of(workspace_id));
create policy "Channels the person sees" on public.chat_channels
  for select to authenticated using (public.chat_can_read(id));
create policy "People of the channels the person sees" on public.chat_channel_members
  for select to authenticated using (public.chat_can_read(channel_id));
create policy "Messages of the channels the person sees" on public.chat_messages
  for select to authenticated using (public.chat_can_read(channel_id));
create policy "Reactions in the channels the person sees" on public.chat_reactions
  for select to authenticated using (public.chat_can_read(channel_id));

-- Realtime: a signal to a private topic (ids only). Does nothing where the realtime
-- service is not installed (a test database), and never stops a write.
create function public.chat_signal(topic text, event text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)' using payload, event, topic;
  end if;
exception when others then
  null;
end;
$$;

create function public.chat_signal_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_table_name = 'chat_messages' then
    perform public.chat_signal('chat:' || (row_ ->> 'channel_id'), 'message',
      jsonb_build_object('id', row_ ->> 'id', 'thread_root_id', row_ ->> 'thread_root_id', 'op', lower(tg_op)));
  elsif tg_table_name = 'chat_reactions' then
    perform public.chat_signal('chat:' || (row_ ->> 'channel_id'), 'reaction', jsonb_build_object('message_id', row_ ->> 'message_id'));
  elsif tg_table_name = 'chat_channels' then
    perform public.chat_signal('chat:' || (row_ ->> 'id'), 'channel', jsonb_build_object('id', row_ ->> 'id', 'op', lower(tg_op)));
  elsif tg_table_name = 'chat_channel_members' then
    perform public.chat_signal('chat:' || (row_ ->> 'channel_id'), 'members', jsonb_build_object('user_id', row_ ->> 'user_id'));
    perform public.chat_signal('chat-user:' || (row_ ->> 'user_id'), 'channels', jsonb_build_object('channel_id', row_ ->> 'channel_id', 'op', lower(tg_op)));
  end if;
  return null;
end;
$$;
create trigger chat_messages_signal after insert or update on public.chat_messages
  for each row execute function public.chat_signal_change();
create trigger chat_reactions_signal after insert or delete on public.chat_reactions
  for each row execute function public.chat_signal_change();
create trigger chat_channels_signal after update on public.chat_channels
  for each row execute function public.chat_signal_change();
create trigger chat_channel_members_signal after insert or delete or update of role, invited on public.chat_channel_members
  for each row execute function public.chat_signal_change();
revoke execute on function public.chat_signal(text, text, jsonb), public.chat_signal_change() from public, anon, authenticated;

-- Who may join which realtime topic (only where the realtime service is installed).
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$create policy "Chat topics of the channels the person sees" on realtime.messages
      for select to authenticated
      using (extension = 'broadcast' and public.chat_topic_allowed(realtime.topic()))$p$;
  end if;
end;
$$;

-- People leaving the workspace leave its channels and categories.
create function public.drop_chat_access_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.chat_channel_members where workspace_id = new.workspace_id and user_id = new.user_id;
    delete from public.chat_category_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger workspace_members_drop_chat_access after update of status on public.workspace_members
  for each row execute function public.drop_chat_access_of_removed_member();
revoke execute on function public.drop_chat_access_of_removed_member() from public, anon, authenticated;

-- ---------------------------------------------------------------- categories

-- Create (cat null) or change a category. Owner and admins.
create function public.chat_save_category(ws uuid, cat uuid, new_name text, is_restricted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
begin
  if not public.is_workspace_member(ws) or not public.chat_is_admin(ws, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 60 then
    return public.ws_error('invalid_name');
  end if;
  if cat is null then
    if (select count(*) from public.chat_categories c where c.workspace_id = ws) >= 100 then
      return public.ws_error('too_many');
    end if;
    insert into public.chat_categories (workspace_id, name, restricted, position, created_by)
    values (ws, btrim(new_name), coalesce(is_restricted, false),
            coalesce((select max(c.position) from public.chat_categories c where c.workspace_id = ws), 0) + 1, auth.uid())
    returning id into saved;
  else
    update public.chat_categories c set name = btrim(new_name), restricted = coalesce(is_restricted, c.restricted)
    where c.id = cat and c.workspace_id = ws
    returning c.id into saved;
    if saved is null then
      return public.ws_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

-- Only an empty category goes (its channels are moved or deleted first).
create function public.chat_delete_category(ws uuid, cat uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) or not public.chat_is_admin(ws, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.chat_categories c where c.id = cat and c.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if exists (select 1 from public.chat_channels c where c.category_id = cat) then
    return public.ws_error('not_empty');
  end if;
  delete from public.chat_categories where id = cat;
  return jsonb_build_object('ok', true);
end;
$$;

-- New order of the workspace's categories (ids in order; others keep theirs after them).
create function public.chat_reorder_categories(ws uuid, ordered uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) or not public.chat_is_admin(ws, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if cardinality(coalesce(ordered, '{}')) > 100 then
    return public.ws_error('too_many');
  end if;
  update public.chat_categories c set position = o.n
  from unnest(ordered) with ordinality as o(id, n)
  where c.id = o.id and c.workspace_id = ws;
  return jsonb_build_object('ok', true);
end;
$$;

-- Who a restricted category is open to: replaces its units and people.
create function public.chat_set_category_access(ws uuid, cat uuid, group_ids uuid[], user_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) or not public.chat_is_admin(ws, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.chat_categories c where c.id = cat and c.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if cardinality(coalesce(group_ids, '{}')) + cardinality(coalesce(user_ids, '{}')) > 500 then
    return public.ws_error('too_many');
  end if;
  if exists (select 1 from unnest(coalesce(group_ids, '{}')) g(id)
             where not exists (select 1 from public.workspace_groups wg where wg.id = g.id and wg.workspace_id = ws))
     or exists (select 1 from unnest(coalesce(user_ids, '{}')) u(id) where not public.is_active_member(ws, u.id)) then
    return public.ws_error('not_found');
  end if;
  delete from public.chat_category_access a where a.category_id = cat
    and not (a.group_id = any (coalesce(group_ids, '{}')) or a.user_id = any (coalesce(user_ids, '{}')));
  insert into public.chat_category_access (workspace_id, category_id, group_id, added_by)
  select distinct ws, cat, g.id, auth.uid() from unnest(coalesce(group_ids, '{}')) g(id)
  on conflict (category_id, group_id) where group_id is not null do nothing;
  insert into public.chat_category_access (workspace_id, category_id, user_id, added_by)
  select distinct ws, cat, u.id, auth.uid() from unnest(coalesce(user_ids, '{}')) u(id)
  on conflict (category_id, user_id) where user_id is not null do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- channels

-- A new channel. Open or closed by the role's rights ("create_open_channels",
-- "create_closed_channels"; never guests); a unit only for a closed one; only in a
-- category open to the creator. The creator becomes its owner.
create function public.chat_create_channel(ws uuid, cat uuid, new_name text, new_topic text, is_closed boolean, unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  made uuid;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid())
     or not public.role_allows(ws, case when coalesce(is_closed, false) then 'create_closed_channels' else 'create_open_channels' end) then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;
  if char_length(coalesce(new_topic, '')) > 250 then
    return public.ws_error('invalid_topic');
  end if;
  if cat is not null and not exists (select 1 from public.chat_categories c where c.id = cat and c.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not public.chat_category_open(cat, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if unit is not null and (not coalesce(is_closed, false)
     or not exists (select 1 from public.workspace_groups g where g.id = unit and g.workspace_id = ws)) then
    return public.ws_error('invalid_unit');
  end if;
  if exists (select 1 from public.chat_channels c where c.workspace_id = ws and c.archived_at is null and lower(btrim(c.name)) = lower(btrim(new_name))) then
    return public.ws_error('name_taken');
  end if;
  if (select count(*) from public.chat_channels c where c.workspace_id = ws) >= 2000 then
    return public.ws_error('too_many');
  end if;
  insert into public.chat_channels (workspace_id, category_id, name, topic, visibility, unit_id, created_by, position)
  values (ws, cat, btrim(new_name), btrim(coalesce(new_topic, '')), case when coalesce(is_closed, false) then 'closed' else 'open' end, unit, auth.uid(),
          coalesce((select max(c.position) from public.chat_channels c where c.workspace_id = ws and c.category_id is not distinct from cat), 0) + 1)
  returning id into made;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, role, invited, added_by)
  values (made, ws, auth.uid(), 'owner', true, auth.uid());
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

-- Name, topic, category and unit (whoever manages the channel). Open stays open and
-- closed stays closed; a new category must be open to the person changing it.
create function public.chat_update_channel(ch uuid, new_name text, new_topic text, new_category uuid, new_unit uuid)
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

create function public.chat_archive_channel(ch uuid, archived boolean)
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
  if not coalesce(archived, true) and exists (select 1 from public.chat_channels o where o.workspace_id = c.workspace_id and o.id <> ch
       and o.archived_at is null and lower(btrim(o.name)) = lower(btrim(c.name))) then
    return public.ws_error('name_taken');
  end if;
  update public.chat_channels set
    archived_at = case when coalesce(archived, true) then coalesce(archived_at, now()) end,
    archived_by = case when coalesce(archived, true) then coalesce(archived_by, auth.uid()) end,
    updated_at = now()
  where id = ch;
  return jsonb_build_object('ok', true);
end;
$$;

-- Deleting a channel takes all its messages (whoever manages it).
create function public.chat_delete_channel(ch uuid)
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
  delete from public.chat_channels where id = ch;
  perform public.log_workspace_action(c.workspace_id, 'chat_channel_deleted', jsonb_build_object('channel', c.name));
  return jsonb_build_object('ok', true);
end;
$$;

-- Join an open channel one sees (it shows up in one's list).
create function public.chat_join_channel(ch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, added_by)
  values (ch, c.workspace_id, auth.uid(), auth.uid())
  on conflict (channel_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Leave a channel. The last owner leaving passes ownership to the longest-standing
-- person added to it.
create function public.chat_leave_channel(ch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  was text;
begin
  delete from public.chat_channel_members where channel_id = ch and user_id = auth.uid() returning role into was;
  if was is null then
    return public.ws_error('not_found');
  end if;
  if was = 'owner' and not exists (select 1 from public.chat_channel_members m where m.channel_id = ch and m.role = 'owner') then
    update public.chat_channel_members set role = 'owner'
    where (channel_id, user_id) = (select m.channel_id, m.user_id from public.chat_channel_members m
                                   where m.channel_id = ch and m.invited order by m.joined_at, m.user_id limit 1);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Add people to a channel. Anyone in the channel (not a guest) adds members; only
-- who manages the channel adds guests. Everyone added must be an active member of
-- the workspace with access to the channel's category.
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

-- Remove someone from a channel (who manages it). Access through a unit stays while
-- the person is in the unit.
create function public.chat_remove_member(ch uuid, person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_manage(ch) then
    return public.ws_error('forbidden');
  end if;
  if person = auth.uid() then
    return public.chat_leave_channel(ch);
  end if;
  delete from public.chat_channel_members where channel_id = ch and user_id = person;
  if not found then
    return public.ws_error('not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Owner or member of the channel (who manages it); only people added to it.
create function public.chat_set_member_role(ch uuid, person uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_manage(ch) then
    return public.ws_error('forbidden');
  end if;
  if new_role not in ('owner', 'member') then
    return public.ws_error('invalid_role');
  end if;
  if public.is_guest((select c.workspace_id from public.chat_channels c where c.id = ch), person) and new_role = 'owner' then
    return public.ws_error('forbidden');
  end if;
  update public.chat_channel_members set role = new_role where channel_id = ch and user_id = person and invited;
  if not found then
    return public.ws_error('not_found');
  end if;
  if not exists (select 1 from public.chat_channel_members m where m.channel_id = ch and m.role = 'owner') then
    update public.chat_channel_members set role = 'owner' where channel_id = ch and user_id = person;
    return public.ws_error('last_owner');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- One's own row for a channel one sees (read mark, notifications): created when missing.
create function public.chat_own_row(ch uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_read(ch) then
    return false;
  end if;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, added_by)
  select c.id, c.workspace_id, auth.uid(), auth.uid() from public.chat_channels c where c.id = ch
  on conflict (channel_id, user_id) do nothing;
  return true;
end;
$$;
revoke execute on function public.chat_own_row(uuid) from public, anon, authenticated;

-- Read up to a moment (now by default); the mark only moves forward. Marks only
-- channels one is in (an open channel one has not joined keeps no mark).
create function public.chat_mark_read(ch uuid, up_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chat_can_read(ch) then
    return public.ws_error('forbidden');
  end if;
  if (select c.visibility from public.chat_channels c where c.id = ch) = 'closed' then
    perform public.chat_own_row(ch);
  end if;
  update public.chat_channel_members set last_read_at = greatest(last_read_at, least(coalesce(up_to, now()), now()))
  where channel_id = ch and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create function public.chat_set_notify(ch uuid, level text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if level not in ('all', 'mentions', 'none') then
    return public.ws_error('invalid_level');
  end if;
  if not public.chat_own_row(ch) then
    return public.ws_error('forbidden');
  end if;
  update public.chat_channel_members set notify = level where channel_id = ch and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- The channels the signed-in person sees in a workspace, with their own state:
-- joined (a row of their own, or a closed channel they reach), read mark,
-- notifications, unread top messages and replies (up to 100) and mentions of them.
create function public.chat_my_channels(ws uuid)
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

-- ---------------------------------------------------------------- messages

-- Only people who see the channel stay among the mentions (at most 50, no repeats).
create function public.chat_clean_mentions(ch uuid, people uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.first), '{}') from (
    select u.id, min(u.n) as first from unnest(coalesce(people, '{}')) with ordinality u(id, n)
    where u.id is not null group by u.id order by min(u.n) limit 50
  ) p where public.chat_can_see(ch, p.id);
$$;
revoke execute on function public.chat_clean_mentions(uuid, uuid[]) from public, anon, authenticated;

-- Write a message (thread_root: a reply in that thread). At most 30 a minute per person.
create function public.chat_post_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[])
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

-- Only the author edits, while still seeing the channel.
create function public.chat_edit_message(msg uuid, new_body text, mention_ids uuid[])
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

-- The author, or whoever manages the channel. The text, mentions, pin and reactions
-- go; "deleted" stays in its place (and a thread keeps its replies).
create function public.chat_delete_message(msg uuid)
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
     or (m.author_id is distinct from auth.uid() and not public.chat_can_manage(m.channel_id)) then
    return public.ws_error('forbidden');
  end if;
  delete from public.chat_reactions where message_id = msg;
  update public.chat_messages set body = '', mentions = '{}', deleted_at = now(), deleted_by = auth.uid(), pinned_at = null, pinned_by = null
  where id = msg;
  if m.thread_root_id is not null then
    update public.chat_messages set reply_count = greatest(reply_count - 1, 0) where id = m.thread_root_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Pin or unpin (anyone in the channel); at most 50 pinned in a channel.
create function public.chat_pin_message(msg uuid, pinned boolean)
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

-- Put or take back one's reaction; at most 20 different ones on a message.
create function public.chat_toggle_reaction(msg uuid, reaction text)
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

revoke execute on function
  public.chat_save_category(uuid, uuid, text, boolean),
  public.chat_delete_category(uuid, uuid),
  public.chat_reorder_categories(uuid, uuid[]),
  public.chat_set_category_access(uuid, uuid, uuid[], uuid[]),
  public.chat_create_channel(uuid, uuid, text, text, boolean, uuid),
  public.chat_update_channel(uuid, text, text, uuid, uuid),
  public.chat_archive_channel(uuid, boolean),
  public.chat_delete_channel(uuid),
  public.chat_join_channel(uuid),
  public.chat_leave_channel(uuid),
  public.chat_add_members(uuid, uuid[]),
  public.chat_remove_member(uuid, uuid),
  public.chat_set_member_role(uuid, uuid, text),
  public.chat_mark_read(uuid, timestamptz),
  public.chat_set_notify(uuid, text),
  public.chat_my_channels(uuid),
  public.chat_post_message(uuid, text, uuid, uuid[]),
  public.chat_edit_message(uuid, text, uuid[]),
  public.chat_delete_message(uuid),
  public.chat_pin_message(uuid, boolean),
  public.chat_toggle_reaction(uuid, text)
from public, anon;
grant execute on function
  public.chat_save_category(uuid, uuid, text, boolean),
  public.chat_delete_category(uuid, uuid),
  public.chat_reorder_categories(uuid, uuid[]),
  public.chat_set_category_access(uuid, uuid, uuid[], uuid[]),
  public.chat_create_channel(uuid, uuid, text, text, boolean, uuid),
  public.chat_update_channel(uuid, text, text, uuid, uuid),
  public.chat_archive_channel(uuid, boolean),
  public.chat_delete_channel(uuid),
  public.chat_join_channel(uuid),
  public.chat_leave_channel(uuid),
  public.chat_add_members(uuid, uuid[]),
  public.chat_remove_member(uuid, uuid),
  public.chat_set_member_role(uuid, uuid, text),
  public.chat_mark_read(uuid, timestamptz),
  public.chat_set_notify(uuid, text),
  public.chat_my_channels(uuid),
  public.chat_post_message(uuid, text, uuid, uuid[]),
  public.chat_edit_message(uuid, text, uuid[]),
  public.chat_delete_message(uuid),
  public.chat_pin_message(uuid, boolean),
  public.chat_toggle_reaction(uuid, text)
to authenticated;

-- ---------------------------------------------------------------- rights and people

-- Two new rights of workspace roles, on by default for members.
create or replace function public.role_permission_default(perm text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select perm in ('create_pages', 'create_objects', 'manage_collections', 'create_open_channels', 'create_closed_channels');
$$;


-- A guest also sees the people of the channels they were added to, and who writes there.
create or replace function public.guest_sees(ws uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws and m.user_id = other and m.status = 'active' and m.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.page_access mine
      join public.page_access theirs on theirs.page_id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.page_access mine
      join public.pages p on p.id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (p.owner_id, p.updated_by)
    )
    or exists (
      select 1 from public.page_access mine
      join public.comment_threads t on t.page_id = mine.page_id
      join public.comments c on c.thread_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.task_project_access theirs on theirs.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (t.assignee_id, t.reporter_id, t.updated_by)
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_comments c on c.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_events e on e.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and e.actor_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_object_access theirs on theirs.object_id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_objects o on o.id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (o.owner_id, o.updated_by)
    )
    or exists (
      select 1 from public.chat_channel_members mine
      join public.chat_channel_members theirs on theirs.channel_id = mine.channel_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and mine.invited and theirs.user_id = other
    )
    or exists (
      select 1 from public.chat_channel_members mine
      join public.chat_messages msg on msg.channel_id = mine.channel_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and mine.invited and msg.author_id = other
    );
$$;
revoke execute on function public.guest_sees(uuid, uuid) from public, anon, authenticated;

