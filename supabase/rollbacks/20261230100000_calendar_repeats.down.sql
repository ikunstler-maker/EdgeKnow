-- Undo 20261230100000_calendar_repeats.
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
    union select created_by from public.leave_policies where workspace_id = ws
    union select user_id from public.leave_balances where workspace_id = ws
    union select created_by from public.leave_balances where workspace_id = ws
    union select user_id from public.leave_requests where workspace_id = ws
    union select deputy_id from public.leave_requests where workspace_id = ws
    union select decided_by from public.leave_requests where workspace_id = ws
    union select cancelled_by from public.leave_requests where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
drop function public.calendar_remind_me(uuid);
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
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change',
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
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
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
             -- Who and when; the kind of absence stays in the request itself.
             case when l.id is not null and not public.is_guest(ws, auth.uid())
                       and (l.user_id = auth.uid() or l.deputy_id = auth.uid() or public.leave_can_decide(ws, l.user_id, auth.uid()))
                  then jsonb_build_object('id', l.id, 'person', coalesce(lp.name, lp.email), 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status,
                                          'mine', l.user_id = auth.uid(), 'deputy', coalesce(l.deputy_id = auth.uid(), false)) end as leave
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
      left join public.leave_requests l on l.id = n.leave_request_id
      left join public.profiles lp on lp.id = l.user_id
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;
delete from public.notifications where kind = 'event_reminder';
update public.notification_prefs set muted = array_remove(muted, 'event_reminder') where 'event_reminder' = any (muted);
alter table public.notifications
  drop constraint notifications_kind_check,
  drop column event_at,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info'));
drop function public.split_calendar_event(uuid, date, jsonb);
drop function public.end_calendar_series(uuid, date);
drop function public.cancel_calendar_occurrence(uuid, date, boolean);
drop function public.change_calendar_occurrence(uuid, date, jsonb);
drop function public.calendar_event_details(uuid, date);
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
revoke execute on function public.calendar_event_details(uuid) from public, anon;
grant execute on function public.calendar_event_details(uuid) to authenticated;
create or replace function public.calendar_busy(ws uuid, people uuid[], range_from timestamptz, range_to timestamptz)
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
create or replace function public.calendar_events_in(ws uuid, range_from timestamptz, range_to timestamptz)
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
create or replace function public.update_calendar_event(target uuid, fields jsonb)
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
create or replace function public.create_calendar_event(ws uuid, fields jsonb, people uuid[])
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
create or replace function public.calendar_event_problem(fields jsonb)
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
drop function public.calendar_repeat_columns(jsonb);
drop function public.calendar_series_has(uuid, date);
drop function public.calendar_event_occurrences(uuid, timestamptz, timestamptz);
drop function public.calendar_series(timestamptz, timestamptz, text, text, integer, smallint[], date, timestamptz, timestamptz);
drop table public.calendar_event_exceptions;
-- A series becomes its first day again.
alter table public.calendar_events
  drop constraint calendar_events_repeat_check,
  drop column reminder_minutes,
  drop column repeat_count,
  drop column repeat_until,
  drop column repeat_days,
  drop column repeat_interval,
  drop column repeat_freq;
