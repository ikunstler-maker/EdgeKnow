-- Doba (company calendar), phase 1a: events, their people, join requests, free/busy.
-- The same in supabase/team/migrations/0043_calendar_events.sql.
-- Rollback: supabase/rollbacks/20261228100000_calendar_events.down.sql

-- Four kinds of events:
--   open    — every member sees it and joins on their own;
--   request — every member sees it and asks to join, the organizer decides;
--   invite  — only the invited (and the workspace's owner and admins) see it;
--   private — only the invited see it.
-- Whoever can't see an event still learns when a colleague is busy: calendar_busy()
-- gives only the start and the end, never the title or the people.
-- Guests see only the events they are invited to and get no free/busy of others.

create table public.calendar_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  description   text not null default '' check (char_length(description) <= 10000),
  location      text not null default '' check (char_length(location) <= 300),
  meeting_url   text check (meeting_url is null or (char_length(meeting_url) <= 500 and meeting_url ~ '^https://[^[:space:]]+$')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  -- A whole-day event keeps its dates as UTC midnights and is shown without a time zone.
  all_day       boolean not null default false,
  time_zone     text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  visibility    text not null default 'open' check (visibility in ('open', 'request', 'invite', 'private')),
  -- Repeats (phase 2): empty until then.
  recurrence    text check (recurrence is null or char_length(recurrence) <= 500),
  organizer_id  uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id) on delete set null,
  check (ends_at > starts_at and ends_at <= starts_at + interval '31 days')
);
create index calendar_events_range_idx on public.calendar_events (workspace_id, starts_at, ends_at);
create index calendar_events_organizer_idx on public.calendar_events (organizer_id);

-- One row per person of an event; a request to join is a row too.
create table public.calendar_event_attendees (
  event_id      uuid not null references public.calendar_events (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        text not null check (status in ('invited', 'requested', 'accepted', 'tentative', 'declined', 'rejected')),
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (event_id, user_id)
);
create index calendar_event_attendees_user_idx on public.calendar_event_attendees (user_id, workspace_id);
create index calendar_event_attendees_workspace_idx on public.calendar_event_attendees (workspace_id);

-- One row per workspace: working days of the week (1 = Monday … 7 = Sunday) and the
-- time zone new events start with.
create table public.calendar_settings (
  workspace_id  uuid primary key references public.workspaces (id) on delete cascade,
  work_days     smallint[] not null default '{1,2,3,4,5}'
                check (cardinality(work_days) between 1 and 7 and work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  time_zone     text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- Does this person see the event itself (title, people, link)?
create function public.calendar_event_visible_to(target uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(e.organizer_id = person, false)
        or exists (select 1 from public.calendar_event_attendees a
                   where a.event_id = e.id and a.user_id = person and a.status in ('invited', 'accepted', 'tentative', 'declined'))
        or (e.visibility in ('open', 'request') and m.role <> 'guest')
        or (e.visibility = 'invite' and m.role in ('owner', 'admin'))
    from public.calendar_events e
    join public.workspace_members m on m.workspace_id = e.workspace_id and m.user_id = person and m.status = 'active'
      and (m.role <> 'guest' or m.access_until is null or m.access_until > now())
    where e.id = target
  ), false);
$$;
revoke execute on function public.calendar_event_visible_to(uuid, uuid) from public, anon, authenticated;

create function public.calendar_event_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.calendar_event_visible_to(target, auth.uid());
$$;
revoke execute on function public.calendar_event_visible(uuid) from public, anon;
grant execute on function public.calendar_event_visible(uuid) to authenticated;

-- Who changes an event: its organizer. Who may cancel or bring it back: the organizer,
-- and the owner and admins unless it is private.
create function public.can_cancel_calendar_event(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_workspace_member(e.workspace_id)
       and (coalesce(e.organizer_id = auth.uid(), false) or (e.visibility <> 'private' and public.is_workspace_admin(e.workspace_id)))
    from public.calendar_events e where e.id = target
  ), false);
$$;
revoke execute on function public.can_cancel_calendar_event(uuid) from public, anon;
grant execute on function public.can_cancel_calendar_event(uuid) to authenticated;

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
alter table public.calendar_settings enable row level security;
revoke all on public.calendar_events, public.calendar_event_attendees, public.calendar_settings from public, anon, authenticated;
grant select on public.calendar_events, public.calendar_event_attendees, public.calendar_settings to authenticated;

create policy "Members see the events open to them" on public.calendar_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.calendar_event_visible(id));
-- Requests to join and refusals: only for the person and the organizer.
create policy "People of an event, for those who see the event" on public.calendar_event_attendees
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id) and public.calendar_event_visible(event_id)
    and (status in ('invited', 'accepted', 'tentative', 'declined') or user_id = auth.uid()
         or exists (select 1 from public.calendar_events e where e.id = event_id and e.organizer_id = auth.uid()))
  );
create policy "Members see the calendar settings" on public.calendar_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Notifications about events. Only ids are kept; the title is read when shown, and
-- only while the person may still see the event.
alter table public.notifications
  add column event_id uuid references public.calendar_events (id) on delete cascade,
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change'));
create index notifications_event_idx on public.notifications (event_id) where event_id is not null;

create function public.notify_event(ws uuid, person uuid, what text, actor uuid, about_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or person is null or person = actor then
    return;
  end if;
  if not public.calendar_event_visible_to(about_event, person) then
    return;
  end if;
  if exists (select 1 from public.notification_prefs p where p.workspace_id = ws and p.user_id = person and what = any (p.muted)) then
    return;
  end if;
  -- The same thing twice within a minute is one notification.
  if exists (select 1 from public.notifications n where n.user_id = person and n.kind = what and n.event_id = about_event
             and n.created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, event_id)
  values (ws, person, what, actor, about_event);
end;
$$;
revoke execute on function public.notify_event(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;

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
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
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
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- What is wrong with an event's fields (null: nothing).
create function public.calendar_event_problem(fields jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  starts timestamptz;
  ends timestamptz;
  link text := nullif(btrim(coalesce(fields ->> 'meeting_url', '')), '');
begin
  begin
    starts := (fields ->> 'starts_at')::timestamptz;
    ends := (fields ->> 'ends_at')::timestamptz;
  exception when others then
    return 'invalid';
  end;
  if starts is null or ends is null or ends <= starts or ends > starts + interval '31 days' then
    return 'bad_time';
  end if;
  if char_length(btrim(coalesce(fields ->> 'title', ''))) not between 1 and 200 then
    return 'bad_title';
  end if;
  if char_length(coalesce(fields ->> 'description', '')) > 10000 or char_length(coalesce(fields ->> 'location', '')) > 300 then
    return 'too_long';
  end if;
  if link is not null and (char_length(link) > 500 or link !~ '^https://[^[:space:]]+$') then
    return 'bad_link';
  end if;
  if coalesce(fields ->> 'visibility', '') not in ('open', 'request', 'invite', 'private') then
    return 'invalid';
  end if;
  if jsonb_typeof(coalesce(fields -> 'all_day', 'false'::jsonb)) <> 'boolean' then
    return 'invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = coalesce(fields ->> 'time_zone', 'UTC')) then
    return 'bad_time_zone';
  end if;
  return null;
end;
$$;
revoke execute on function public.calendar_event_problem(jsonb) from public, anon, authenticated;

create function public.create_calendar_event(ws uuid, fields jsonb, people uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  invited uuid[] := coalesce(people, '{}');
  problem text;
  new_id uuid;
  person uuid;
begin
  -- Guests don't make events.
  if not public.is_workspace_member(ws) or public.is_guest(ws, me) then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;
  problem := public.calendar_event_problem(fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  if cardinality(invited) > 200 or exists (select 1 from unnest(invited) p where not public.is_active_member(ws, p)) then
    return public.page_error('invalid');
  end if;
  if (select count(*) from public.calendar_events e where e.workspace_id = ws and e.created_by = me and e.created_at > now() - interval '1 hour') >= 120 then
    return public.page_error('too_many');
  end if;
  insert into public.calendar_events (workspace_id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, organizer_id, created_by)
  values (ws, btrim(fields ->> 'title'), coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')),
          nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz,
          coalesce((fields ->> 'all_day')::boolean, false), coalesce(fields ->> 'time_zone', 'UTC'), fields ->> 'visibility', me, me)
  returning id into new_id;
  insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, invited_by, responded_at)
  values (new_id, ws, me, 'accepted', me, now());
  for person in select distinct p from unnest(invited) p where p <> me loop
    insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, invited_by) values (new_id, ws, person, 'invited', me);
    perform public.notify_event(ws, person, 'event_invite', me, new_id);
  end loop;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- The organizer changes the event; a new time is told to its people.
create function public.update_calendar_event(target uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  problem text;
  person uuid;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  problem := public.calendar_event_problem(fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  update public.calendar_events set
    title = btrim(fields ->> 'title'),
    description = coalesce(fields ->> 'description', ''),
    location = btrim(coalesce(fields ->> 'location', '')),
    meeting_url = nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''),
    starts_at = (fields ->> 'starts_at')::timestamptz,
    ends_at = (fields ->> 'ends_at')::timestamptz,
    all_day = coalesce((fields ->> 'all_day')::boolean, false),
    time_zone = coalesce(fields ->> 'time_zone', 'UTC'),
    visibility = fields ->> 'visibility',
    updated_at = now()
  where id = target;
  -- Requests belong to "request" events only.
  if fields ->> 'visibility' <> 'request' then
    delete from public.calendar_event_attendees where event_id = target and status in ('requested', 'rejected');
  end if;
  if (e.starts_at, e.ends_at) is distinct from ((fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz) then
    for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
      perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.invite_to_calendar_event(target uuid, people uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  invited uuid[] := coalesce(people, '{}');
  person uuid;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if cardinality(invited) > 200 or exists (select 1 from unnest(invited) p where not public.is_active_member(e.workspace_id, p))
     or (select count(*) from public.calendar_event_attendees a where a.event_id = target) + cardinality(invited) > 500 then
    return public.page_error('invalid');
  end if;
  for person in select distinct p from unnest(invited) p where p <> me loop
    insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, invited_by)
    values (target, e.workspace_id, person, 'invited', me)
    on conflict (event_id, user_id) do update set status = 'invited', invited_by = me, responded_at = null
      where public.calendar_event_attendees.status in ('requested', 'rejected');
    if found then
      perform public.notify_event(e.workspace_id, person, 'event_invite', me, target);
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.remove_calendar_event_attendee(target uuid, person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.calendar_events;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from auth.uid() or person = auth.uid() then
    return public.page_error('forbidden');
  end if;
  delete from public.calendar_event_attendees where event_id = target and user_id = person;
  return jsonb_build_object('ok', true);
end;
$$;

-- "I'll come", "maybe", "I won't". Without an invitation: an open event is joined at
-- once, a "request" event gets a request the organizer decides on.
create function public.respond_to_calendar_event(target uuid, answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  mine public.calendar_event_attendees;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or not public.calendar_event_visible(target) then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if answer is null or answer not in ('accepted', 'tentative', 'declined') then
    return public.page_error('invalid');
  end if;
  select * into mine from public.calendar_event_attendees where event_id = target and user_id = me;
  if e.organizer_id = me then
    return public.page_error('organizer');
  end if;
  if mine.status in ('invited', 'accepted', 'tentative', 'declined') then
    update public.calendar_event_attendees set status = answer, responded_at = now() where event_id = target and user_id = me;
    return jsonb_build_object('ok', true, 'status', answer);
  end if;
  if mine.status = 'rejected' then
    return public.page_error('forbidden');
  end if;
  if mine.status = 'requested' then
    -- Taking the request back.
    if answer = 'declined' then
      delete from public.calendar_event_attendees where event_id = target and user_id = me;
      return jsonb_build_object('ok', true, 'status', null);
    end if;
    return jsonb_build_object('ok', true, 'status', 'requested');
  end if;
  if answer = 'declined' then
    return jsonb_build_object('ok', true, 'status', null);
  end if;
  if (select count(*) from public.calendar_event_attendees a where a.event_id = target) >= 500 then
    return public.page_error('too_many');
  end if;
  if e.visibility = 'open' then
    insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, responded_at) values (target, e.workspace_id, me, answer, now());
    return jsonb_build_object('ok', true, 'status', answer);
  end if;
  if e.visibility = 'request' then
    insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status) values (target, e.workspace_id, me, 'requested');
    perform public.notify_event(e.workspace_id, e.organizer_id, 'event_request', me, target);
    return jsonb_build_object('ok', true, 'status', 'requested');
  end if;
  return public.page_error('forbidden');
end;
$$;

-- The organizer lets a person in or refuses.
create function public.decide_calendar_event_request(target uuid, person uuid, approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  update public.calendar_event_attendees set status = case when coalesce(approve, false) then 'accepted' else 'rejected' end, responded_at = now()
  where event_id = target and user_id = person and status = 'requested';
  if not found then
    return public.page_error('not_found');
  end if;
  -- A refused person no longer sees a hidden event, so they hear only of a "yes" there.
  perform public.notify_event(e.workspace_id, person, 'event_answer', me, target);
  return jsonb_build_object('ok', true);
end;
$$;

-- Cancel (kept for 30 days) and bring back.
create function public.cancel_calendar_event(target uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  person uuid;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.can_cancel_calendar_event(target) then
    return public.page_error('forbidden');
  end if;
  if coalesce(restore, false) then
    update public.calendar_events set deleted_at = null, deleted_by = null where id = target;
    return jsonb_build_object('ok', true);
  end if;
  if e.deleted_at is not null then
    return jsonb_build_object('ok', true);
  end if;
  update public.calendar_events set deleted_at = now(), deleted_by = me where id = target;
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
  end loop;
  -- An admin cancelled it: the organizer hears too.
  perform public.notify_event(e.workspace_id, e.organizer_id, 'event_change', me, target);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_calendar_settings(ws uuid, new_work_days smallint[], new_time_zone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) or not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  if new_work_days is null or cardinality(new_work_days) not between 1 and 7 or not new_work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new_time_zone) then
    return public.page_error('invalid');
  end if;
  insert into public.calendar_settings (workspace_id, work_days, time_zone, updated_by)
  values (ws, (select array_agg(distinct d order by d) from unnest(new_work_days) d), new_time_zone, auth.uid())
  on conflict (workspace_id) do update set work_days = excluded.work_days, time_zone = excluded.time_zone, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- The events of a period that the person sees, in one pass: membership, "guest" and
-- "admin" are worked out once per call, not per event. Same rows as reading the table.
create function public.calendar_events_in(ws uuid, range_from timestamptz, range_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select public.is_workspace_member(ws) as member, public.is_guest(ws, auth.uid()) as guest, public.is_workspace_admin(ws) as admin
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at, x.id), '[]'::jsonb) from (
    select e.id, e.title, e.location, e.meeting_url, e.starts_at, e.ends_at, e.all_day, e.time_zone, e.visibility,
           e.organizer_id, coalesce(o.name, o.email) as organizer, mine.status as my_status,
           (select count(*) from public.calendar_event_attendees a where a.event_id = e.id and a.status = 'accepted') as going,
           case when e.organizer_id = auth.uid()
                then (select count(*) from public.calendar_event_attendees a where a.event_id = e.id and a.status = 'requested') else 0 end as requests
    from public.calendar_events e
    cross join ctx
    left join public.calendar_event_attendees mine on mine.event_id = e.id and mine.user_id = auth.uid()
    left join public.profiles o on o.id = e.organizer_id
    where e.workspace_id = ws and e.deleted_at is null and ctx.member
      and range_to > range_from and range_to <= range_from + interval '100 days'
      and e.starts_at < range_to and e.ends_at > range_from
      and (coalesce(e.organizer_id = auth.uid(), false)
           or coalesce(mine.status in ('invited', 'accepted', 'tentative', 'declined'), false)
           or (e.visibility in ('open', 'request') and not ctx.guest)
           or (e.visibility = 'invite' and ctx.admin))
    order by e.starts_at, e.id
    limit 3000
  ) x;
$$;

-- One event with its people. Requests and refusals: for the organizer; one's own always.
create function public.calendar_event_details(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
begin
  select * into e from public.calendar_events where id = target;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or not public.calendar_event_visible(target) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'location', e.location, 'meeting_url', e.meeting_url,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day, 'time_zone', e.time_zone, 'visibility', e.visibility,
      'organizer_id', e.organizer_id, 'cancelled', e.deleted_at is not null),
    'can_edit', coalesce(e.organizer_id = me, false),
    'can_cancel', public.can_cancel_calendar_event(target),
    'my_status', (select a.status from public.calendar_event_attendees a where a.event_id = target and a.user_id = me),
    'attendees', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.user_id, 'name', coalesce(p.name, p.email), 'status', a.status) order by (a.user_id = e.organizer_id) desc, coalesce(p.name, p.email), a.user_id)
      from public.calendar_event_attendees a
      join public.profiles p on p.id = a.user_id
      where a.event_id = target
        and (a.status in ('invited', 'accepted', 'tentative', 'declined') or a.user_id = me or coalesce(e.organizer_id = me, false))
    ), '[]'::jsonb));
end;
$$;

-- When people are busy: only the start and the end of what they attend — no title, no
-- people, no kind — so a meeting isn't put over someone's hidden event.
create function public.calendar_busy(ws uuid, people uuid[], range_from timestamptz, range_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'all_day', b.all_day)
                            order by b.user_id, b.starts_at, b.ends_at), '[]'::jsonb)
  from (
    select distinct a.user_id, e.starts_at, e.ends_at, e.all_day
    from public.calendar_event_attendees a
    join public.calendar_events e on e.id = a.event_id
    where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
      and cardinality(coalesce(people, '{}')) between 1 and 50
      and range_to > range_from and range_to <= range_from + interval '100 days'
      and e.workspace_id = ws and e.deleted_at is null
      and a.user_id = any (people) and a.status in ('invited', 'accepted', 'tentative')
      and e.starts_at < range_to and e.ends_at > range_from
    limit 5000
  ) b;
$$;

-- Cancelled events go for good after 30 days.
create function public.purge_calendar_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.calendar_events where deleted_at < now() - interval '30 days';
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke execute on function public.purge_calendar_events() from public, anon, authenticated;

-- Run daily by the server's cleanup (src/app/api/cron/cleanup-files), in every database.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_calendar_events() to service_role;
  end if;
end;
$$;

revoke execute on function
  public.create_calendar_event(uuid, jsonb, uuid[]),
  public.update_calendar_event(uuid, jsonb),
  public.invite_to_calendar_event(uuid, uuid[]),
  public.remove_calendar_event_attendee(uuid, uuid),
  public.respond_to_calendar_event(uuid, text),
  public.decide_calendar_event_request(uuid, uuid, boolean),
  public.cancel_calendar_event(uuid, boolean),
  public.set_calendar_settings(uuid, smallint[], text),
  public.calendar_events_in(uuid, timestamptz, timestamptz),
  public.calendar_event_details(uuid),
  public.calendar_busy(uuid, uuid[], timestamptz, timestamptz)
from public, anon;
grant execute on function
  public.create_calendar_event(uuid, jsonb, uuid[]),
  public.update_calendar_event(uuid, jsonb),
  public.invite_to_calendar_event(uuid, uuid[]),
  public.remove_calendar_event_attendee(uuid, uuid),
  public.respond_to_calendar_event(uuid, text),
  public.decide_calendar_event_request(uuid, uuid, boolean),
  public.cancel_calendar_event(uuid, boolean),
  public.set_calendar_settings(uuid, smallint[], text),
  public.calendar_events_in(uuid, timestamptz, timestamptz),
  public.calendar_event_details(uuid),
  public.calendar_busy(uuid, uuid[], timestamptz, timestamptz)
to authenticated;

-- CENTRAL ONLY
-- Moving a workspace into its team database also brings the people of its events.
create or replace function public.team_move_people(ws uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with ids as (
    select owner_id as id from public.pages where workspace_id = ws
    union select created_by from public.pages where workspace_id = ws
    union select updated_by from public.pages where workspace_id = ws
    union select deleted_by from public.pages where workspace_id = ws
    union select user_id from public.page_access where workspace_id = ws
    union select granted_by from public.page_access where workspace_id = ws
    union select created_by from public.comment_threads where workspace_id = ws
    union select resolved_by from public.comment_threads where workspace_id = ws
    union select author_id from public.comments where workspace_id = ws
    union select uploaded_by from public.attachments where workspace_id = ws
    union select user_id from public.page_mentions where workspace_id = ws
    union select mentioned_by from public.page_mentions where workspace_id = ws
    union select user_id from public.page_contributions where workspace_id = ws
    union select actor_id from public.audit_log where workspace_id = ws
    union select user_id from public.workspace_members where workspace_id = ws
    union select owner_id from public.workspaces where id = ws
    union select reporter_id from public.tasks where workspace_id = ws
    union select assignee_id from public.tasks where workspace_id = ws
    union select updated_by from public.tasks where workspace_id = ws
    union select deleted_by from public.tasks where workspace_id = ws
    union select author_id from public.task_comments where workspace_id = ws
    union select actor_id from public.task_events where workspace_id = ws
    union select user_id from public.task_project_access where workspace_id = ws
    union select created_by from public.task_projects where workspace_id = ws
    union select owner_id from public.service_objects where workspace_id = ws
    union select created_by from public.service_objects where workspace_id = ws
    union select updated_by from public.service_objects where workspace_id = ws
    union select deleted_by from public.service_objects where workspace_id = ws
    union select user_id from public.service_object_access where workspace_id = ws
    union select organizer_id from public.calendar_events where workspace_id = ws
    union select created_by from public.calendar_events where workspace_id = ws
    union select deleted_by from public.calendar_events where workspace_id = ws
    union select user_id from public.calendar_event_attendees where workspace_id = ws
    union select invited_by from public.calendar_event_attendees where workspace_id = ws
    union select updated_by from public.calendar_settings where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
