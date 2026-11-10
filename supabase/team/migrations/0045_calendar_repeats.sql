-- Doba, phase 2a (repeating events, reminders) in a team's own database (as supabase/migrations/20261230100000_calendar_repeats.sql).
-- Rollback: supabase/team/rollbacks/0045_calendar_repeats.down.sql

-- A series is one event with a rule (every N days / weeks on chosen days / months /
-- years, until a date). "After N times" is turned into that date when saved, so reading
-- never counts from the start. The days of a series are worked out when read, in the
-- event's own time zone (10:00 stays 10:00 across a clock change).
-- One day of a series that is cancelled or changed is a row of calendar_event_exceptions.
-- "This and the following" ends the old series the day before and starts a new event.
-- Everything that reads a period — the calendar, free/busy, reminders — goes through
-- calendar_event_occurrences(), so a cancelled day is nowhere and a moved one is where it went.

-- The column `recurrence` (text, never filled) stays as it is: the rule lives in the columns below.
alter table public.calendar_events
  add column repeat_freq text check (repeat_freq in ('daily', 'weekly', 'monthly', 'yearly')),
  add column repeat_interval smallint not null default 1 check (repeat_interval between 1 and 99),
  -- Weekly: the days of the week (1 = Monday … 7 = Sunday); empty: the day it starts on.
  add column repeat_days smallint[] not null default '{}' check (repeat_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- The last day (in the event's time zone) a day of the series may start on; null: no end.
  add column repeat_until date,
  -- What the organizer asked for ("after N times"); repeat_until is worked out from it.
  add column repeat_count smallint check (repeat_count between 1 and 730),
  -- Minutes before the start when its people are reminded (null: no reminder).
  add column reminder_minutes smallint check (reminder_minutes in (10, 60, 1440)),
  add constraint calendar_events_repeat_check
    check (repeat_freq is not null or (repeat_until is null and repeat_count is null and repeat_days = '{}' and repeat_interval = 1));

create table public.calendar_event_exceptions (
  event_id         uuid not null references public.calendar_events (id) on delete cascade,
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  -- The day of the series this is about: the date it would start on by the rule.
  occurrence_date  date not null,
  cancelled        boolean not null default false,
  -- What differs on that day (null: as in the series).
  starts_at        timestamptz,
  ends_at          timestamptz,
  title            text check (title is null or char_length(btrim(title)) between 1 and 200),
  description      text check (description is null or char_length(description) <= 10000),
  location         text check (location is null or char_length(location) <= 300),
  meeting_url      text check (meeting_url is null or (char_length(meeting_url) <= 500 and meeting_url ~ '^https://[^[:space:]]+$')),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (event_id, occurrence_date),
  check ((starts_at is null) = (ends_at is null)),
  check (starts_at is null or (ends_at > starts_at and ends_at <= starts_at + interval '31 days'))
);
create index calendar_event_exceptions_workspace_idx on public.calendar_event_exceptions (workspace_id);
alter table public.calendar_event_exceptions enable row level security;
revoke all on public.calendar_event_exceptions from public, anon, authenticated;
grant select on public.calendar_event_exceptions to authenticated;
create policy "Changed days of a series, for those who see the event" on public.calendar_event_exceptions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.calendar_event_visible(event_id));

-- The days of a rule that touch a period. No tables: only arithmetic on what is given.
create function public.calendar_series(first_start timestamptz, first_end timestamptz, zone text, freq text, every integer, week_days smallint[],
                                       last_day date, range_from timestamptz, range_to timestamptz)
returns table (occurrence_date date, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  local0 timestamp := first_start at time zone zone;
  length interval := (first_end at time zone zone) - local0;
  -- A day that starts after `lo` may still reach into the period.
  lo timestamp := (range_from at time zone zone) - length;
  hi timestamp := range_to at time zone zone;
  step integer := greatest(coalesce(every, 1), 1);
  days smallint[];
  week0 date;
  cur timestamp;
  k integer;
  n integer := 0;
  d smallint;
begin
  if freq is null then
    if first_start < range_to and first_end > range_from then
      occurrence_date := local0::date; starts_at := first_start; ends_at := first_end;
      return next;
    end if;
    return;
  end if;
  if last_day is not null and hi > (last_day + 1)::timestamp then
    hi := (last_day + 1)::timestamp;
  end if;
  if freq = 'daily' then
    k := greatest(0, floor(extract(epoch from (lo - local0)) / 86400 / step)::integer);
    loop
      cur := local0 + (k * step) * interval '1 day';
      exit when cur >= hi or n > 800;
      if cur > lo then
        occurrence_date := cur::date; starts_at := cur at time zone zone; ends_at := (cur + length) at time zone zone;
        return next;
      end if;
      k := k + 1; n := n + 1;
    end loop;
  elsif freq = 'weekly' then
    days := case when cardinality(coalesce(week_days, '{}')) = 0 then array[extract(isodow from local0)::smallint]
                 else (select array_agg(distinct x order by x) from unnest(week_days) x) end;
    week0 := local0::date - (extract(isodow from local0)::integer - 1);
    k := greatest(0, floor((lo::date - week0)::numeric / (7 * step))::integer);
    loop
      exit when (week0 + k * 7 * step)::timestamp >= hi or n > 800;
      foreach d in array days loop
        cur := (week0 + k * 7 * step + (d - 1)) + local0::time;
        if cur >= local0 and cur > lo and cur < hi then
          occurrence_date := cur::date; starts_at := cur at time zone zone; ends_at := (cur + length) at time zone zone;
          return next;
        end if;
      end loop;
      k := k + 1; n := n + 1;
    end loop;
  else
    -- Monthly and yearly: the same day of the month; a month without it (the 31st, 29 February) is skipped.
    if freq = 'yearly' then
      step := step * 12;
    end if;
    k := greatest(0, floor((((extract(year from lo) - extract(year from local0)) * 12 + extract(month from lo) - extract(month from local0)) / step))::integer - 1);
    loop
      cur := local0 + (k * step) * interval '1 month';
      exit when cur >= hi or n > 800;
      if cur > lo and extract(day from cur) = extract(day from local0) then
        occurrence_date := cur::date; starts_at := cur at time zone zone; ends_at := (cur + length) at time zone zone;
        return next;
      end if;
      k := k + 1; n := n + 1;
    end loop;
  end if;
end;
$$;
revoke execute on function public.calendar_series(timestamptz, timestamptz, text, text, integer, smallint[], date, timestamptz, timestamptz) from public, anon, authenticated;

-- The days of one event in a period as they really are: without the cancelled ones,
-- the changed ones with their own time and texts. A single event is one such day.
create function public.calendar_event_occurrences(target uuid, range_from timestamptz, range_to timestamptz)
returns table (occurrence_date date, starts_at timestamptz, ends_at timestamptz, title text, location text, meeting_url text, changed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.occurrence_date, s.starts_at, s.ends_at, coalesce(x.title, e.title), coalesce(x.location, e.location), coalesce(x.meeting_url, e.meeting_url), x.event_id is not null
  from public.calendar_events e
  cross join lateral public.calendar_series(e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days, e.repeat_until, range_from, range_to) s
  left join public.calendar_event_exceptions x on x.event_id = e.id and x.occurrence_date = s.occurrence_date
  where e.id = target and (x.event_id is null or (not x.cancelled and x.starts_at is null))
  union all
  -- A day moved to another time is found by where it is now, wherever it was by the rule.
  select x.occurrence_date, x.starts_at, x.ends_at, coalesce(x.title, e.title), coalesce(x.location, e.location), coalesce(x.meeting_url, e.meeting_url), true
  from public.calendar_events e
  join public.calendar_event_exceptions x on x.event_id = e.id
  where e.id = target and not x.cancelled and x.starts_at is not null and x.starts_at < range_to and x.ends_at > range_from;
$$;
revoke execute on function public.calendar_event_occurrences(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Is this date a day of the series by its rule (whatever was changed on it since)?
create function public.calendar_series_has(target uuid, day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_events e
    cross join lateral public.calendar_series(e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days, e.repeat_until,
                                              (day - 1)::timestamp at time zone 'UTC', (day + 2)::timestamp at time zone 'UTC') s
    where e.id = target and e.repeat_freq is not null and s.occurrence_date = day);
$$;
revoke execute on function public.calendar_series_has(uuid, date) from public, anon, authenticated;

-- What is wrong with an event's fields (null: nothing). Now with the repeat rule and the reminder.
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
  rule jsonb := case when jsonb_typeof(fields -> 'repeat') = 'object' then fields -> 'repeat' end;
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
  if fields ? 'reminder_minutes' and jsonb_typeof(fields -> 'reminder_minutes') <> 'null'
     and coalesce(fields ->> 'reminder_minutes', '') not in ('10', '60', '1440') then
    return 'invalid';
  end if;
  if fields ? 'repeat' and jsonb_typeof(fields -> 'repeat') not in ('object', 'null') then
    return 'bad_repeat';
  end if;
  if rule is not null then
    begin
      if coalesce(rule ->> 'freq', '') not in ('daily', 'weekly', 'monthly', 'yearly')
         or coalesce((rule ->> 'interval')::integer, 1) not between 1 and 99
         or (rule ? 'count' and jsonb_typeof(rule -> 'count') <> 'null' and (rule ->> 'count')::integer not between 1 and 730)
         or (rule ? 'count' and jsonb_typeof(rule -> 'count') <> 'null' and rule ? 'until' and jsonb_typeof(rule -> 'until') <> 'null')
         or (rule ? 'until' and jsonb_typeof(rule -> 'until') <> 'null'
             and (rule ->> 'until')::date < (starts at time zone coalesce(fields ->> 'time_zone', 'UTC'))::date)
         or (rule ? 'days' and (jsonb_typeof(rule -> 'days') <> 'array' or jsonb_array_length(rule -> 'days') > 7
             or exists (select 1 from jsonb_array_elements_text(rule -> 'days') x where x not in ('1', '2', '3', '4', '5', '6', '7')))) then
        return 'bad_repeat';
      end if;
    exception when others then
      return 'bad_repeat';
    end;
    -- A day of a series shouldn't run into the next one for longer than a week.
    if ends > starts + interval '7 days' then
      return 'bad_repeat';
    end if;
  end if;
  return null;
end;
$$;

-- The rule of checked fields as the columns keep it. "After N times" becomes the date of the N-th day.
create function public.calendar_repeat_columns(fields jsonb, out freq text, out every smallint, out week_days smallint[], out last_day date, out times smallint)
language plpgsql
stable
set search_path = ''
as $$
declare
  rule jsonb := case when jsonb_typeof(fields -> 'repeat') = 'object' then fields -> 'repeat' end;
  zone text := coalesce(fields ->> 'time_zone', 'UTC');
  starts timestamptz := (fields ->> 'starts_at')::timestamptz;
  ends timestamptz := (fields ->> 'ends_at')::timestamptz;
begin
  every := 1;
  week_days := '{}';
  if rule is null then
    return;
  end if;
  freq := rule ->> 'freq';
  every := coalesce((rule ->> 'interval')::smallint, 1);
  if freq = 'weekly' and jsonb_typeof(rule -> 'days') = 'array' then
    week_days := coalesce((select array_agg(distinct x::smallint order by x::smallint) from jsonb_array_elements_text(rule -> 'days') x), '{}');
  end if;
  last_day := nullif(rule ->> 'until', '')::date;
  times := nullif(rule ->> 'count', '')::smallint;
  if times is not null then
    select max(o.occurrence_date) into last_day from (
      select s.occurrence_date from public.calendar_series(starts, ends, zone, freq, every, week_days, null, starts - interval '1 day', starts + interval '70 years') s
      order by s.starts_at limit times) o;
  end if;
end;
$$;
revoke execute on function public.calendar_repeat_columns(jsonb) from public, anon, authenticated;

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
  rule record;
  new_id uuid;
  person uuid;
begin
  -- Guests don't make events.
  if not public.is_workspace_member(ws) or public.is_guest(ws, me) then
    return public.page_error('forbidden');
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
  select * into rule from public.calendar_repeat_columns(fields);
  insert into public.calendar_events (workspace_id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, organizer_id, created_by,
                                      repeat_freq, repeat_interval, repeat_days, repeat_until, repeat_count, reminder_minutes)
  values (ws, btrim(fields ->> 'title'), coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')),
          nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz,
          coalesce((fields ->> 'all_day')::boolean, false), coalesce(fields ->> 'time_zone', 'UTC'), fields ->> 'visibility', me, me,
          rule.freq, rule.every, rule.week_days, rule.last_day, rule.times, (fields ->> 'reminder_minutes')::smallint)
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

-- The organizer changes the event — for a series, all of its days. A new time or rule
-- is told to its people, and the days changed one by one start afresh.
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
  rule record;
  moved boolean;
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
  select * into rule from public.calendar_repeat_columns(fields);
  moved := (e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days)
           is distinct from ((fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz, coalesce(fields ->> 'time_zone', 'UTC'), rule.freq, rule.every, rule.week_days);
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
    repeat_freq = rule.freq, repeat_interval = rule.every, repeat_days = rule.week_days, repeat_until = rule.last_day, repeat_count = rule.times,
    reminder_minutes = (fields ->> 'reminder_minutes')::smallint,
    updated_at = now()
  where id = target;
  -- The days no longer line up with the old ones; and nothing is kept past the new end.
  if moved then
    delete from public.calendar_event_exceptions where event_id = target;
  elsif rule.last_day is not null then
    delete from public.calendar_event_exceptions where event_id = target and occurrence_date > rule.last_day;
  end if;
  -- Requests belong to "request" events only.
  if fields ->> 'visibility' <> 'request' then
    delete from public.calendar_event_attendees where event_id = target and status in ('requested', 'rejected');
  end if;
  if moved or e.repeat_until is distinct from rule.last_day then
    for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
      perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Only this event": one day of a series gets its own time and texts.
create function public.change_calendar_occurrence(target uuid, occurrence date, fields jsonb)
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
  if occurrence is null or not public.calendar_series_has(target, occurrence) then
    return public.page_error('not_found');
  end if;
  -- The series' own kind, zone and rule stay; only this day's time and texts are checked.
  problem := public.calendar_event_problem((fields - 'repeat') || jsonb_build_object('visibility', e.visibility, 'time_zone', e.time_zone, 'all_day', e.all_day));
  if problem is not null then
    return public.page_error(problem);
  end if;
  insert into public.calendar_event_exceptions (event_id, workspace_id, occurrence_date, cancelled, starts_at, ends_at, title, description, location, meeting_url, updated_by)
  values (target, e.workspace_id, occurrence, false, (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz, btrim(fields ->> 'title'),
          coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')), nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), me)
  on conflict (event_id, occurrence_date) do update set cancelled = false, starts_at = excluded.starts_at, ends_at = excluded.ends_at, title = excluded.title,
    description = excluded.description, location = excluded.location, meeting_url = excluded.meeting_url, updated_by = me, updated_at = now();
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

-- One day of a series is cancelled (or brought back as the series has it).
create function public.cancel_calendar_occurrence(target uuid, occurrence date, restore boolean)
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
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if occurrence is null or not public.calendar_series_has(target, occurrence) then
    return public.page_error('not_found');
  end if;
  if coalesce(restore, false) then
    delete from public.calendar_event_exceptions where event_id = target and occurrence_date = occurrence and cancelled;
    return jsonb_build_object('ok', true);
  end if;
  insert into public.calendar_event_exceptions (event_id, workspace_id, occurrence_date, cancelled, updated_by)
  values (target, e.workspace_id, occurrence, true, me)
  on conflict (event_id, occurrence_date) do update set cancelled = true, updated_by = me, updated_at = now();
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
  end loop;
  perform public.notify_event(e.workspace_id, e.organizer_id, 'event_change', me, target);
  return jsonb_build_object('ok', true);
end;
$$;

-- The series ends before this day: the day and everything after it are gone, what was
-- before stays as it was. From its very first day that is the whole event.
create function public.end_calendar_series(target uuid, occurrence date)
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
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if occurrence is null or not public.calendar_series_has(target, occurrence) then
    return public.page_error('not_found');
  end if;
  if occurrence <= (e.starts_at at time zone e.time_zone)::date then
    return public.cancel_calendar_event(target, false);
  end if;
  update public.calendar_events set repeat_until = occurrence - 1, repeat_count = null, updated_at = now() where id = target;
  delete from public.calendar_event_exceptions where event_id = target and occurrence_date >= occurrence;
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = target and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, target);
  end loop;
  perform public.notify_event(e.workspace_id, e.organizer_id, 'event_change', me, target);
  return jsonb_build_object('ok', true);
end;
$$;

-- "This and the following": the old series ends the day before, and a new event with
-- the same people (and their answers) starts on this day with the new fields and rule.
create function public.split_calendar_event(target uuid, occurrence date, fields jsonb)
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
                                      repeat_freq, repeat_interval, repeat_days, repeat_until, repeat_count, reminder_minutes)
  values (e.workspace_id, btrim(fields ->> 'title'), coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')),
          nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz,
          coalesce((fields ->> 'all_day')::boolean, false), coalesce(fields ->> 'time_zone', 'UTC'), fields ->> 'visibility', me, me,
          rule.freq, rule.every, rule.week_days, rule.last_day, rule.times, (fields ->> 'reminder_minutes')::smallint)
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

-- The events of a period that the person sees — a series as each of its days there.
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
    select e.id, o.title, o.location, o.meeting_url, o.starts_at, o.ends_at, e.all_day, e.time_zone, e.visibility,
           e.organizer_id, coalesce(p.name, p.email) as organizer, mine.status as my_status,
           (select count(*) from public.calendar_event_attendees a where a.event_id = e.id and a.status = 'accepted') as going,
           case when e.organizer_id = auth.uid()
                then (select count(*) from public.calendar_event_attendees a where a.event_id = e.id and a.status = 'requested') else 0 end as requests,
           e.repeat_freq is not null as recurring, case when e.repeat_freq is not null then o.occurrence_date end as occurrence, o.changed
    from public.calendar_events e
    cross join ctx
    left join public.calendar_event_attendees mine on mine.event_id = e.id and mine.user_id = auth.uid()
    left join public.profiles p on p.id = e.organizer_id
    cross join lateral public.calendar_event_occurrences(e.id, range_from, range_to) o
    where e.workspace_id = ws and e.deleted_at is null and ctx.member
      and range_to > range_from and range_to <= range_from + interval '100 days'
      and e.starts_at < range_to + interval '32 days'
      and case when e.repeat_freq is null then e.ends_at > range_from
               else e.repeat_until is null or e.repeat_until >= (range_from - interval '40 days')::date end
      and (coalesce(e.organizer_id = auth.uid(), false)
           or coalesce(mine.status in ('invited', 'accepted', 'tentative', 'declined'), false)
           or (e.visibility in ('open', 'request') and not ctx.guest)
           or (e.visibility = 'invite' and ctx.admin))
    order by o.starts_at, e.id
    limit 3000
  ) x;
$$;

-- One event with its people; with `occurrence`, that day of a series as it really is.
drop function public.calendar_event_details(uuid);
create function public.calendar_event_details(target uuid, occurrence date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  x public.calendar_event_exceptions;
  day_start timestamptz;
  day_end timestamptz;
  known boolean := false;
begin
  select * into e from public.calendar_events where id = target;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or not public.calendar_event_visible(target) then
    return public.page_error('forbidden');
  end if;
  day_start := e.starts_at;
  day_end := e.ends_at;
  if e.repeat_freq is not null and occurrence is not null then
    select s.starts_at, s.ends_at, true into day_start, day_end, known
    from public.calendar_series(e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days, e.repeat_until,
                                (occurrence - 1)::timestamp at time zone 'UTC', (occurrence + 2)::timestamp at time zone 'UTC') s
    where s.occurrence_date = occurrence;
    if not coalesce(known, false) then
      return public.page_error('not_found');
    end if;
    select * into x from public.calendar_event_exceptions where event_id = target and occurrence_date = occurrence;
  end if;
  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', e.id, 'title', coalesce(x.title, e.title), 'description', coalesce(x.description, e.description),
      'location', coalesce(x.location, e.location), 'meeting_url', coalesce(x.meeting_url, e.meeting_url),
      'starts_at', coalesce(x.starts_at, day_start), 'ends_at', coalesce(x.ends_at, day_end), 'all_day', e.all_day, 'time_zone', e.time_zone, 'visibility', e.visibility,
      'organizer_id', e.organizer_id, 'cancelled', e.deleted_at is not null or coalesce(x.cancelled, false),
      'reminder_minutes', e.reminder_minutes),
    'series', case when e.repeat_freq is not null then jsonb_build_object(
      'freq', e.repeat_freq, 'interval', e.repeat_interval, 'days', to_jsonb(e.repeat_days), 'until', case when e.repeat_count is null then e.repeat_until end, 'count', e.repeat_count,
      'last_day', e.repeat_until, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'title', e.title, 'description', e.description, 'location', e.location, 'meeting_url', e.meeting_url,
      'occurrence', case when known then occurrence end, 'changed', x.event_id is not null and not x.cancelled, 'day_cancelled', coalesce(x.cancelled, false) and e.deleted_at is null) end,
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

-- When people are busy: the real days of every event they attend — a cancelled day of a
-- series frees the time, a moved one is busy where it went. Still only starts and ends.
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
    select distinct a.user_id, o.starts_at, o.ends_at, e.all_day
    from public.calendar_event_attendees a
    join public.calendar_events e on e.id = a.event_id
    cross join lateral public.calendar_event_occurrences(e.id, range_from, range_to) o
    where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
      and cardinality(coalesce(people, '{}')) between 1 and 50
      and range_to > range_from and range_to <= range_from + interval '100 days'
      and e.workspace_id = ws and e.deleted_at is null
      and a.user_id = any (people) and a.status in ('invited', 'accepted', 'tentative')
      and e.starts_at < range_to + interval '32 days'
      and case when e.repeat_freq is null then e.ends_at > range_from
               else e.repeat_until is null or e.repeat_until >= (range_from - interval '40 days')::date end
    limit 5000
  ) b;
$$;

-- Reminders. Nothing runs on a clock here: when a person's bell asks for news, the
-- events of theirs that start within the reminder's time get a notification — once per
-- event and start.
alter table public.notifications
  add column event_at timestamptz,
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info'));

create function public.calendar_remind_me(ws uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  added integer := 0;
begin
  if me is null or not public.is_workspace_member(ws)
     or exists (select 1 from public.notification_prefs p where p.workspace_id = ws and p.user_id = me and 'event_reminder' = any (p.muted)) then
    return 0;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, event_id, event_at)
  select ws, me, 'event_reminder', e.organizer_id, e.id, o.starts_at
  from public.calendar_event_attendees a
  join public.calendar_events e on e.id = a.event_id
  cross join lateral public.calendar_event_occurrences(e.id, now(), now() + e.reminder_minutes * interval '1 minute') o
  where a.user_id = me and a.workspace_id = ws and a.status in ('invited', 'accepted', 'tentative')
    and e.deleted_at is null and e.reminder_minutes is not null
    and e.starts_at <= now() + interval '2 days'
    and (e.repeat_freq is not null or e.ends_at > now())
    and o.starts_at > now() and o.starts_at <= now() + e.reminder_minutes * interval '1 minute'
    and not exists (select 1 from public.notifications n where n.user_id = me and n.kind = 'event_reminder' and n.event_id = e.id and n.event_at = o.starts_at);
  get diagnostics added = row_count;
  return added;
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
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(n.event_at, e.starts_at), 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
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
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.change_calendar_occurrence(uuid, date, jsonb),
  public.cancel_calendar_occurrence(uuid, date, boolean),
  public.end_calendar_series(uuid, date),
  public.split_calendar_event(uuid, date, jsonb),
  public.calendar_event_details(uuid, date),
  public.calendar_remind_me(uuid)
from public, anon;
grant execute on function
  public.change_calendar_occurrence(uuid, date, jsonb),
  public.cancel_calendar_occurrence(uuid, date, boolean),
  public.end_calendar_series(uuid, date),
  public.split_calendar_event(uuid, date, jsonb),
  public.calendar_event_details(uuid, date),
  public.calendar_remind_me(uuid)
to authenticated;
