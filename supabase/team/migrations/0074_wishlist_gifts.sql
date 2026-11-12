-- Wishlists, step 3 in a team's own database (as supabase/migrations/20270130100000_wishlist_gifts.sql).
-- Rollback: supabase/team/rollbacks/0074_wishlist_gifts.down.sql

-- "I'll give this": per wish, one person gives it and others may chip in. Seen by the
-- people who see the wishlist — never by its owner (a surprise stays a surprise).
create table public.wishlist_gifts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  wishlist_id  uuid not null references public.service_objects (id) on delete cascade,
  item_id      text not null check (item_id ~ '^[a-z0-9-]{1,40}$'),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('gives', 'chips_in')),
  created_at   timestamptz not null default now(),
  unique (wishlist_id, item_id, user_id)
);
create unique index wishlist_gifts_one_giver on public.wishlist_gifts (wishlist_id, item_id) where kind = 'gives';
create index wishlist_gifts_user_idx on public.wishlist_gifts (workspace_id, user_id);

create function public.check_wishlist_gift_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.wishlist_id and o.service = 'wishlists') then
    raise exception 'gift and wishlist must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger wishlist_gifts_same_workspace before insert or update on public.wishlist_gifts
  for each row execute function public.check_wishlist_gift_workspace();

alter table public.wishlist_gifts enable row level security;
revoke all on public.wishlist_gifts from public, anon, authenticated;
grant select on public.wishlist_gifts to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.wishlist_gifts to service_role;
  end if;
end $$;
-- Only viewers: the owner's role is "owner", so the owner never reads them.
create policy "Viewers of a wishlist see who gives, its owner never"
  on public.wishlist_gifts for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(wishlist_id) = 'viewer');

-- Notes in the bell about a wish or a wishlist that went away: what it was is kept in the
-- note itself, since the wishlist or the wish is gone.
alter table public.notifications add column detail jsonb;
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday', 'chat_mention', 'chat_reply',
                    'wishlist_item_removed', 'wishlist_deleted'));

-- A colleague who sees the wishlist gives a wish ("gives", one person) or chips in.
create function public.wishlist_gift(target uuid, item text, gift_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  ws uuid;
begin
  if public.wishlist_role_of(target, me) is distinct from 'viewer' then
    return public.page_error('forbidden');
  end if;
  if gift_kind not in ('gives', 'chips_in')
     or not exists (select 1 from public.service_objects o, jsonb_array_elements(o.data -> 'items') i where o.id = target and i ->> 'id' = item) then
    return public.page_error('invalid');
  end if;
  select o.workspace_id into ws from public.service_objects o where o.id = target;
  if gift_kind = 'gives' and exists (select 1 from public.wishlist_gifts g where g.wishlist_id = target and g.item_id = item and g.kind = 'gives' and g.user_id <> me) then
    return public.page_error('taken');
  end if;
  insert into public.wishlist_gifts (workspace_id, wishlist_id, item_id, user_id, kind)
  values (ws, target, item, me, gift_kind)
  on conflict (wishlist_id, item_id, user_id) do update set kind = excluded.kind, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- One takes back one's own part in a wish.
create function public.wishlist_ungift(target uuid, item text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.wishlist_role_of(target, auth.uid()) is distinct from 'viewer' then
    return public.page_error('forbidden');
  end if;
  delete from public.wishlist_gifts g where g.wishlist_id = target and g.item_id = item and g.user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- Who gives what, for a viewer of the wishlist (names included, for chipping in).
create function public.wishlist_gifts_of(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.wishlist_role_of(target, auth.uid()) is distinct from 'viewer' then public.page_error('forbidden')
    else jsonb_build_object('ok', true, 'gifts', coalesce((
      select jsonb_agg(jsonb_build_object('item', g.item_id, 'kind', g.kind, 'name', coalesce(p.name, p.email), 'mine', g.user_id = auth.uid())
                       order by g.item_id, g.kind desc, g.created_at)
      from public.wishlist_gifts g join public.profiles p on p.id = g.user_id
      where g.wishlist_id = target), '[]'::jsonb)) end;
$$;

-- For the owner, before removing a wish or the wishlist: which wishes somebody means to
-- give — only that, never who or how many.
create function public.wishlist_claimed_items(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.wishlist_role_of(target, auth.uid()) is distinct from 'owner' then public.page_error('forbidden')
    else jsonb_build_object('ok', true, 'items', coalesce((
      select jsonb_agg(distinct g.item_id) from public.wishlist_gifts g where g.wishlist_id = target), '[]'::jsonb)) end;
$$;

-- Tells the people taking part in the given wishes (all of them when items is null) that
-- the wish or the whole wishlist went away, then forgets their parts. Muted kinds stay quiet.
create function public.wishlist_notify_gone(target uuid, items text[], note_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.service_objects;
begin
  select * into w from public.service_objects o where o.id = target;
  if not found then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, detail)
  select g.workspace_id, g.user_id, note_kind, w.owner_id,
         jsonb_build_object('wishlist_id', case when note_kind = 'wishlist_item_removed' then w.id end,
                            'wishlist', nullif(w.title, ''),
                            'item', case when note_kind = 'wishlist_item_removed'
                                         then (select i ->> 'title' from jsonb_array_elements(w.data -> 'items') i where i ->> 'id' = g.item_id limit 1) end,
                            'birthday', w.data ->> 'birthday')
  from (select distinct on (g.user_id, case when items is null then '' else g.item_id end) g.*
        from public.wishlist_gifts g
        where g.wishlist_id = target and (items is null or g.item_id = any (items))
        order by g.user_id, case when items is null then '' else g.item_id end, g.created_at) g
  where not exists (select 1 from public.notification_prefs p where p.workspace_id = g.workspace_id and p.user_id = g.user_id and note_kind = any (p.muted));
  delete from public.wishlist_gifts g where g.wishlist_id = target and (items is null or g.item_id = any (items));
end;
$$;

revoke execute on function public.check_wishlist_gift_workspace(), public.wishlist_notify_gone(uuid, text[], text) from public, anon, authenticated;
revoke execute on function
  public.wishlist_gift(uuid, text, text), public.wishlist_ungift(uuid, text), public.wishlist_gifts_of(uuid), public.wishlist_claimed_items(uuid)
from public, anon;
grant execute on function
  public.wishlist_gift(uuid, text, text), public.wishlist_ungift(uuid, text), public.wishlist_gifts_of(uuid), public.wishlist_claimed_items(uuid)
to authenticated;

create or replace function public.my_notifications(ws uuid, max_rows integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.workspace_id = ws and n.user_id = auth.uid() and n.read_at is null),
    'items', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select n.id, n.kind, n.created_at, n.read_at,
             coalesce(a.name, a.email) as actor,
             case when t.id is not null and public.task_role(t.id) is not null
                  then jsonb_build_object('id', t.id, 'key', p.key || '-' || t.number, 'number', t.number, 'project', p.key, 'title', t.title, 'status', s.name) end as task,
             case when g.id is not null and public.page_role_of(g.id, auth.uid()) is not null
                  then jsonb_build_object('id', g.id, 'title', g.title) end as page,
             case when e.id is not null and public.calendar_event_visible(e.id)
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(n.event_at, e.starts_at), 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
             -- Who and when; the kind of absence stays in the request itself.
             case when l.id is not null and not public.is_guest(ws, auth.uid())
                       and (l.user_id = auth.uid() or l.deputy_id = auth.uid() or public.leave_can_decide(ws, l.user_id, auth.uid()))
                  then jsonb_build_object('id', l.id, 'person', coalesce(lp.name, lp.email), 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status,
                                          'mine', l.user_id = auth.uid(), 'deputy', coalesce(l.deputy_id = auth.uid(), false)) end as leave,
             -- A birthday: whose and which day — while it may still be seen.
             case when n.kind = 'birthday' and public.birthday_visible(ws, n.actor_id)
                  then jsonb_build_object('person', coalesce(a.name, a.email), 'day', (n.event_at at time zone 'UTC')::date) end as birthday,
             -- A chat message: its channel and the start of its text — while the message is there and the channel seen.
             case when cm.id is not null and cm.deleted_at is null and public.chat_can_read(cm.channel_id)
                  then jsonb_build_object('id', cm.id, 'channel_id', cm.channel_id, 'channel', ch.name, 'thread_root_id', cm.thread_root_id,
                                          'excerpt', left(cm.body, 140)) end as chat,
             -- A wish or a wishlist that went away: what it was, kept in the note.
             case when n.kind in ('wishlist_item_removed', 'wishlist_deleted') then n.detail end as wishlist
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
      left join public.leave_requests l on l.id = n.leave_request_id
      left join public.profiles lp on lp.id = l.user_id
      left join public.chat_messages cm on cm.id = n.chat_message_id
      left join public.chat_channels ch on ch.id = cm.channel_id
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;

create or replace function public.set_notification_prefs(ws uuid, new_muted text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday', 'chat_mention', 'chat_reply',
                                           'wishlist_item_removed', 'wishlist_deleted']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_service_object(target_object uuid, new_title text, new_data jsonb, base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, object.title)) > 200 then
    return public.page_error('title_too_long');
  end if;
  if new_data is not null and pg_column_size(new_data) > 1048576 then
    return public.page_error('too_large');
  end if;
  if object.service = 'apps' and new_data is not null and not public.app_data_ok(new_data) then
    return public.page_error('invalid');
  end if;
  -- A wishlist keeps its birthday and publication (changed by their own functions).
  if object.service = 'wishlists' and new_data is not null then
    new_data := new_data || jsonb_build_object('birthday', object.data -> 'birthday', 'published', coalesce(object.data -> 'published', 'false'::jsonb));
    if not public.wishlist_data_ok(new_data) then
      return public.page_error('invalid');
    end if;
  end if;
  if base_version is distinct from object.version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', object.version);
  end if;
  -- Wishes taken out that somebody meant to give: tell them, then forget their parts.
  if object.service = 'wishlists' and new_data is not null then
    perform public.wishlist_notify_gone(target_object, array(
      select distinct g.item_id from public.wishlist_gifts g where g.wishlist_id = target_object
        and not exists (select 1 from jsonb_array_elements(new_data -> 'items') i where i ->> 'id' = g.item_id)), 'wishlist_item_removed');
  end if;
  update public.service_objects set
    title = coalesce(btrim(new_title), title),
    data = coalesce(new_data, data),
    search_text = case when new_data is not null then public.service_object_text(new_data) else search_text end,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_object;
  -- Pictures no wish uses any more (and older than an hour, so a fresh upload is safe) go.
  if object.service = 'wishlists' and new_data is not null then
    delete from public.object_files f where f.object_id = target_object and f.created_at < now() - interval '1 hour'
      and not exists (select 1 from jsonb_array_elements(new_data -> 'items') i where i ->> 'image' = f.id::text);
  end if;
  return jsonb_build_object('ok', true, 'version', object.version + 1);
end;
$$;

create or replace function public.delete_wishlist(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.wishlist_role_of(target, auth.uid()) is distinct from 'owner' then
    return public.page_error('forbidden');
  end if;
  -- Everyone taking part in a gift hears that the wishlist is gone.
  perform public.wishlist_notify_gone(target, null, 'wishlist_deleted');
  delete from public.service_objects where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  -- Their birthday and job title are forgotten too (the start date stays for the time-off records).
  update public.leave_member_settings set birth_month = null, birth_day = null, birth_year = null, birthday_shown = true, job_title = null
  where workspace_id = old.workspace_id and user_id = old.user_id and (birth_month is not null or job_title is not null);
  -- Their parts in gifts go too.
  delete from public.wishlist_gifts where workspace_id = old.workspace_id and user_id = old.user_id;
  return null;
end;
$$;
