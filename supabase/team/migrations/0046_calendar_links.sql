-- Doba, phase 2b (Rukh due dates, units invited to events, search and chips) in a team's own database
-- (as supabase/migrations/20261231100000_calendar_links.sql).
-- Rollback: supabase/team/rollbacks/0046_calendar_links.down.sql

-- Whole units invited to an event are remembered (plain ids: a unit may go later), so the
-- organizer can bring in whoever joined them since. Their people are ordinary invited
-- people: a unit is turned into them when it is added, not kept as a living list.
alter table public.calendar_events
  add column invited_group_ids uuid[] not null default '{}' check (cardinality(invited_group_ids) <= 20);

-- The organizer invites a unit: everyone in it and in the units under it (not guests, not
-- the leads of the units above). Who already answered — also "not going" — is left alone.
create function public.invite_unit_to_calendar_event(target uuid, unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  people uuid[];
  invited jsonb;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = unit and g.workspace_id = e.workspace_id) then
    return public.page_error('not_found');
  end if;
  if not (unit = any (e.invited_group_ids)) and cardinality(e.invited_group_ids) >= 20 then
    return public.page_error('too_many');
  end if;
  with recursive down as (
    select g.id, 0 as level from public.workspace_groups g where g.id = unit
    union all
    select g.id, d.level + 1 from public.workspace_groups g join down d on g.parent_id = d.id where d.level < 10
  )
  select coalesce(array_agg(distinct gm.user_id), '{}') into people
  from public.workspace_group_members gm
  join public.workspace_members m on m.workspace_id = e.workspace_id and m.user_id = gm.user_id and m.status = 'active' and m.role <> 'guest'
  where gm.group_id in (select id from down) and gm.user_id <> me
    and not exists (select 1 from public.calendar_event_attendees a
                    where a.event_id = target and a.user_id = gm.user_id and a.status in ('invited', 'accepted', 'tentative', 'declined'));
  if cardinality(people) > 200 then
    return public.page_error('too_many');
  end if;
  if cardinality(people) > 0 then
    invited := public.invite_to_calendar_event(target, people);
    if not coalesce((invited ->> 'ok')::boolean, false) then
      return invited;
    end if;
  end if;
  update public.calendar_events set invited_group_ids = array_append(invited_group_ids, unit)
  where id = target and not (unit = any (invited_group_ids));
  return jsonb_build_object('ok', true, 'added', cardinality(people));
end;
$$;

-- "Refresh": the units invited before are gone through again — whoever joined them since is invited.
create function public.refresh_calendar_event_units(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.calendar_events;
  unit uuid;
  step jsonb;
  added integer := 0;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from auth.uid() then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  -- Units that no longer exist are forgotten.
  update public.calendar_events set invited_group_ids = array(
    select u from unnest(e.invited_group_ids) u where exists (select 1 from public.workspace_groups g where g.id = u and g.workspace_id = e.workspace_id))
  where id = target
  returning invited_group_ids into e.invited_group_ids;
  foreach unit in array e.invited_group_ids loop
    step := public.invite_unit_to_calendar_event(target, unit);
    if not coalesce((step ->> 'ok')::boolean, false) then
      return step;
    end if;
    added := added + (step ->> 'added')::integer;
  end loop;
  return jsonb_build_object('ok', true, 'added', added);
end;
$$;

-- A series split in two keeps its units.
create or replace function public.split_calendar_event(target uuid, occurrence date, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  problem text;
  rule record;
  before integer;
  new_fields jsonb := fields;
  new_id uuid;
  person uuid;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if occurrence is null or not public.calendar_series_has(target, occurrence) then
    return public.page_error('not_found');
  end if;
  -- From the first day on it is simply the whole series.
  if occurrence <= (e.starts_at at time zone e.time_zone)::date then
    return public.update_calendar_event(target, fields) || jsonb_build_object('id', target);
  end if;
  problem := public.calendar_event_problem(fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  -- "After N times" counted from the very start: the new part gets what is left of it.
  if e.repeat_count is not null and (fields #>> '{repeat,count}') is not null and (fields #>> '{repeat,count}')::integer = e.repeat_count then
    select count(*) into before
    from public.calendar_series(e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days, occurrence - 1,
                                e.starts_at - interval '1 day', e.starts_at + interval '70 years');
    new_fields := jsonb_set(fields, '{repeat,count}', to_jsonb(greatest(e.repeat_count - before, 1)));
  end if;
  select * into rule from public.calendar_repeat_columns(new_fields);
  update public.calendar_events set repeat_until = occurrence - 1, repeat_count = null, updated_at = now() where id = target;
  delete from public.calendar_event_exceptions where event_id = target and occurrence_date >= occurrence;
  insert into public.calendar_events (workspace_id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, organizer_id, created_by,
                                      repeat_freq, repeat_interval, repeat_days, repeat_until, repeat_count, reminder_minutes, invited_group_ids)
  values (e.workspace_id, btrim(fields ->> 'title'), coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')),
          nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz,
          coalesce((fields ->> 'all_day')::boolean, false), coalesce(fields ->> 'time_zone', 'UTC'), fields ->> 'visibility', me, me,
          rule.freq, rule.every, rule.week_days, rule.last_day, rule.times, (fields ->> 'reminder_minutes')::smallint, e.invited_group_ids)
  returning id into new_id;
  insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, invited_by, created_at, responded_at)
  select new_id, a.workspace_id, a.user_id, a.status, a.invited_by, a.created_at, a.responded_at
  from public.calendar_event_attendees a
  where a.event_id = target and (fields ->> 'visibility' = 'request' or a.status not in ('requested', 'rejected'));
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = new_id and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, new_id);
  end loop;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;
-- Tasks with a due date in a period, for the calendar. Exactly the tasks the person may
-- read in Rukh: every project goes through project_tasks(), the same one-pass rule the
-- board uses (membership, the project role, boards open to the person, frozen columns,
-- private tasks). So somebody else's private task isn't here at all — no title, no key,
-- no sign that the day has anything. supabase/tests/stage56_calendar_links.sql compares
-- this with reading the table.
-- Open tasks, and done ones for 14 days after they were done; `only_mine`: where the
-- person is the assignee or takes part.
create function public.calendar_tasks(ws uuid, first_day date, last_day date, only_mine boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or first_day is null or last_day is null or last_day < first_day or last_day - first_day > 100 then '[]'::jsonb
  else coalesce((
    select jsonb_agg(to_jsonb(x) order by x.due_date, x.project, x.number) from (
      select t.id, p.key || '-' || t.number as key, p.key as project, t.number, t.title, t.due_date, t.done_at is not null as done, t.priority,
             (t.assignee_id is not distinct from auth.uid()
              or exists (select 1 from public.task_participants tp where tp.task_id = t.id and tp.user_id = auth.uid())) as mine
      from public.task_projects p
      cross join lateral public.project_tasks(p.id) t
      where p.workspace_id = ws and p.archived_at is null
        and t.deleted_at is null and t.due_date between first_day and last_day
        and (t.done_at is null or t.done_at >= now() - interval '14 days')
        and (not coalesce(only_mine, true) or t.assignee_id is not distinct from auth.uid()
             or exists (select 1 from public.task_participants tp where tp.task_id = t.id and tp.user_id = auth.uid()))
      order by t.due_date, p.key, t.number
      limit 2000
    ) x), '[]'::jsonb) end;
$$;

-- The start an event is shown with in a search result or a chip: for a series, its next
-- day (or the first, when none is ahead).
create function public.calendar_event_next_start(target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.repeat_freq is null then e.starts_at
              else coalesce((select min(o.starts_at) from public.calendar_event_occurrences(e.id, now(), now() + interval '100 days') o), e.starts_at) end
  from public.calendar_events e where e.id = target;
$$;
revoke execute on function public.calendar_event_next_start(uuid) from public, anon, authenticated;

-- Search: events the person sees whose title, place or description has the words —
-- coming ones first. A hidden event is not found by who can't see it.
create function public.search_calendar_events(ws uuid, query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select public.is_workspace_member(ws) as member, public.is_guest(ws, auth.uid()) as guest, public.is_workspace_admin(ws) as admin,
           '%' || replace(replace(replace(left(btrim(coalesce(query, '')), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ahead desc, x.distance, x.id), '[]'::jsonb) from (
    select f.id, f.title, f.location, f.all_day, f.recurring, f.starts_at, f.starts_at >= now() as ahead, abs(extract(epoch from (f.starts_at - now()))) as distance
    from (
      select e.id, e.title, e.location, e.all_day, e.repeat_freq is not null as recurring, public.calendar_event_next_start(e.id) as starts_at
      from public.calendar_events e
      cross join ctx
      left join public.calendar_event_attendees mine on mine.event_id = e.id and mine.user_id = auth.uid()
      where e.workspace_id = ws and e.deleted_at is null and ctx.member
        and (e.title ilike ctx.pattern or e.location ilike ctx.pattern or e.description ilike ctx.pattern)
        and (coalesce(e.organizer_id = auth.uid(), false)
             or coalesce(mine.status in ('invited', 'accepted', 'tentative', 'declined'), false)
             or (e.visibility in ('open', 'request') and not ctx.guest)
             or (e.visibility = 'invite' and ctx.admin))
    ) f
    order by ahead desc, distance, f.id
    limit 20
  ) x;
$$;

-- Event chips on a wiki page: only the id is stored; the title and time are read with
-- the reader's own access. An event the reader can't see is simply not in the answer.
create function public.calendar_event_chips(ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', public.calendar_event_next_start(e.id), 'all_day', e.all_day,
                                               'recurring', e.repeat_freq is not null, 'cancelled', e.deleted_at is not null)), '[]'::jsonb)
  from public.calendar_events e
  where cardinality(coalesce(ids, '{}')) between 1 and 200 and e.id = any (ids)
    and public.is_workspace_member(e.workspace_id) and public.calendar_event_visible(e.id);
$$;

revoke execute on function
  public.invite_unit_to_calendar_event(uuid, uuid),
  public.refresh_calendar_event_units(uuid),
  public.calendar_tasks(uuid, date, date, boolean),
  public.search_calendar_events(uuid, text),
  public.calendar_event_chips(uuid[])
from public, anon;
grant execute on function
  public.invite_unit_to_calendar_event(uuid, uuid),
  public.refresh_calendar_event_units(uuid),
  public.calendar_tasks(uuid, date, date, boolean),
  public.search_calendar_events(uuid, text),
  public.calendar_event_chips(uuid[])
to authenticated;
