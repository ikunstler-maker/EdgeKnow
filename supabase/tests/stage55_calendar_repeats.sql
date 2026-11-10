-- Doba, phase 2a: repeating events — the days of a rule (also across a clock change and
-- short months), one day changed or cancelled, "this and the following", free/busy that
-- follows all of it, who may do what, reminders.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000055a1', 'alice@rep.test', now()),
 ('00000000-0000-0000-0000-0000000055b1', 'bob@rep.test', now()),
 ('00000000-0000-0000-0000-0000000055c1', 'carl@rep.test', now()),
 ('00000000-0000-0000-0000-0000000055f1', 'eve@other-rep.test', now());
\set alice '00000000-0000-0000-0000-0000000055a1'
\set bob '00000000-0000-0000-0000-0000000055b1'
\set carl '00000000-0000-0000-0000-0000000055c1'
\set eve '00000000-0000-0000-0000-0000000055f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Repeats') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'rep.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carl';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

\set base '{"description": "", "location": "", "time_zone": "Europe/Kyiv", "all_day": false, "visibility": "open"}'
-- The days of a period as "title DD HH:MI" in Kyiv time.
\set days '(select coalesce(string_agg(x ->> ''title'' || '' '' || to_char((x ->> ''starts_at'')::timestamptz at time zone ''Europe/Kyiv'', ''DD HH24:MI''), '', '' order by x ->> ''starts_at'', x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_events_in(:''ws'', ''2030-01-01'', ''2030-02-10'')) x)'
\set busy '(select coalesce(string_agg(to_char((b ->> ''starts_at'')::timestamptz at time zone ''Europe/Kyiv'', ''DD HH24:MI''), '', '' order by b ->> ''starts_at''), ''free'') from jsonb_array_elements(public.calendar_busy(:''ws'', array[:''bob'']::uuid[], ''2030-01-01'', ''2030-02-10'')) b)'

set role authenticated;
set request.jwt.claim.sub = :'bob';
-- Mondays and Wednesdays at 10:00, six times, from Monday 7 January 2030; Carl is invited.
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Sync", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "weekly", "days": [1, 3], "count": 6}}')::jsonb, array[:'carl']::uuid[]) ->> 'id' as sync \gset
select 'six times on Mon and Wed: ' || :days;
select 'kept as: ' || repeat_freq || ' ' || array_to_string(repeat_days, '') || ' until ' || repeat_until || ' (asked for ' || repeat_count || ' times)' from public.calendar_events where id = :'sync';
select 'bob is busy: ' || :busy;

-- Bad rules.
select 'every hour: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "hourly"}}')::jsonb, '{}') ->> 'error')
  || ', zero times: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "daily", "count": 0}}')::jsonb, '{}') ->> 'error')
  || ', a date and a number: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "daily", "count": 3, "until": "2030-02-01"}}')::jsonb, '{}') ->> 'error')
  || ', ends before it starts: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "daily", "until": "2030-01-01"}}')::jsonb, '{}') ->> 'error')
  || ', day 9 of the week: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "repeat": {"freq": "weekly", "days": [9]}}')::jsonb, '{}') ->> 'error')
  || ', a reminder in 7 minutes: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "starts_at": "2030-01-07T08:00:00Z", "ends_at": "2030-01-07T09:00:00Z", "reminder_minutes": 7}')::jsonb, '{}') ->> 'error');

reset role;
-- A clock change (last Sunday of March): 10:00 stays 10:00 in Kyiv.
select 'daily across the clock change: ' || string_agg(to_char(s.starts_at at time zone 'Europe/Kyiv', 'DD HH24:MI') || ' (' || to_char(s.starts_at at time zone 'UTC', 'HH24:MI') || ' UTC)', ', ' order by s.starts_at)
from public.calendar_series('2030-03-29T08:00:00Z', '2030-03-29T09:00:00Z', 'Europe/Kyiv', 'daily', 1, '{}', null, '2030-03-29T00:00:00Z', '2030-04-02T00:00:00Z') s;
-- The 31st of every month: months without it are skipped.
select 'the 31st monthly: ' || string_agg(to_char(s.occurrence_date, 'MM-DD'), ', ' order by s.starts_at)
from public.calendar_series('2030-01-31T08:00:00Z', '2030-01-31T09:00:00Z', 'Europe/Kyiv', 'monthly', 1, '{}', null, '2030-01-01T00:00:00Z', '2030-06-15T00:00:00Z') s;
select '29 February yearly: ' || string_agg(to_char(s.occurrence_date, 'YYYY'), ', ' order by s.starts_at)
from public.calendar_series('2028-02-29T08:00:00Z', '2028-02-29T09:00:00Z', 'UTC', 'yearly', 1, '{}', null, '2028-01-01T00:00:00Z', '2037-01-01T00:00:00Z') s;
select 'every second week from far ahead: ' || string_agg(to_char(s.occurrence_date, 'YYYY-MM-DD'), ', ' order by s.starts_at)
from public.calendar_series('2030-01-07T08:00:00Z', '2030-01-07T09:00:00Z', 'UTC', 'weekly', 2, '{1}', null, '2031-06-01T00:00:00Z', '2031-07-01T00:00:00Z') s;

set role authenticated;
set request.jwt.claim.sub = :'bob';
-- "Only this event": Wednesday the 9th moves to Thursday 15:00 with its own title.
select 'the 9th moves: ' || (public.change_calendar_occurrence(:'sync', '2030-01-09', '{"title": "Sync (moved)", "description": "", "location": "", "starts_at": "2030-01-10T13:00:00Z", "ends_at": "2030-01-10T14:00:00Z"}') ->> 'ok')
  || ', a day that is not of the series: ' || (public.change_calendar_occurrence(:'sync', '2030-01-08', '{"title": "X", "starts_at": "2030-01-08T13:00:00Z", "ends_at": "2030-01-08T14:00:00Z"}') ->> 'error');
select 'now: ' || :days;
select 'bob is busy: ' || :busy;
select 'that day opens as: ' || (d #>> '{event,title}') || ' ' || to_char((d #>> '{event,starts_at}')::timestamptz at time zone 'Europe/Kyiv', 'DD HH24:MI') || ', changed: ' || (d #>> '{series,changed}')
  || '; the next one: ' || (n #>> '{event,title}') || ' ' || to_char((n #>> '{event,starts_at}')::timestamptz at time zone 'Europe/Kyiv', 'DD HH24:MI')
  || '; a wrong day: ' || (public.calendar_event_details(:'sync', '2030-01-08') ->> 'error')
from (select public.calendar_event_details(:'sync', '2030-01-09') as d, public.calendar_event_details(:'sync', '2030-01-14') as n) q;

-- One day cancelled: nowhere, and the time is free.
select 'the 14th is cancelled: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-14', false) ->> 'ok');
select 'now: ' || :days;
select 'bob is busy: ' || :busy;
select 'brought back: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-14', true) ->> 'ok');
select '… then: ' || :days;
select 'cancelled again: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-14', false) ->> 'ok');

-- Who may: the organizer only (an invited colleague not; an outsider nothing at all).
set request.jwt.claim.sub = :'carl';
select 'carl (invited) changes a day: ' || (public.change_calendar_occurrence(:'sync', '2030-01-16', '{"title": "Mine", "starts_at": "2030-01-16T13:00:00Z", "ends_at": "2030-01-16T14:00:00Z"}') ->> 'error')
  || ', cancels a day: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-16', false) ->> 'error')
  || ', ends the series: ' || (public.end_calendar_series(:'sync', '2030-01-16') ->> 'error')
  || ', splits it: ' || (public.split_calendar_event(:'sync', '2030-01-16', (:'base'::jsonb || '{"title": "Mine", "starts_at": "2030-01-16T13:00:00Z", "ends_at": "2030-01-16T14:00:00Z"}')::jsonb) ->> 'error');
select 'carl sees: ' || :days || '; changed days in the table: ' || (select count(*) from public.calendar_event_exceptions);
set request.jwt.claim.sub = :'eve';
select 'eve sees: ' || :days || ', changed days: ' || (select count(*) from public.calendar_event_exceptions) || ', opens a day: ' || (public.calendar_event_details(:'sync', '2030-01-16') ->> 'error')
  || ', cancels a day: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-16', false) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice (owner, an open event) cancels a day: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-16', false) ->> 'ok') || ', changes one: ' || (public.change_calendar_occurrence(:'sync', '2030-01-21', '{"title": "Hers", "starts_at": "2030-01-21T13:00:00Z", "ends_at": "2030-01-21T14:00:00Z"}') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob brings the 16th back: ' || (public.cancel_calendar_occurrence(:'sync', '2030-01-16', true) ->> 'ok');

-- "This and the following" from Monday the 21st: 12:00 from then on. Four days were before
-- it, so two of the six are left for the new part; the old one ends on the 20th.
select public.split_calendar_event(:'sync', '2030-01-21', (:'base'::jsonb || '{"title": "Sync at noon", "starts_at": "2030-01-21T10:00:00Z", "ends_at": "2030-01-21T11:00:00Z", "repeat": {"freq": "weekly", "days": [1, 3], "count": 6}}')::jsonb) ->> 'id' as noon \gset
select 'after the split: ' || :days;
select 'the old series: until ' || o.repeat_until || ', changed days kept: ' || (select count(*) from public.calendar_event_exceptions where event_id = o.id)
  || '; the new one: until ' || n.repeat_until || ', ' || n.repeat_count || ' times, people: '
  || (select string_agg(split_part(p.email, '@', 1) || ' ' || a.status, ', ' order by p.email) from public.calendar_event_attendees a join public.profiles p on p.id = a.user_id where a.event_id = n.id)
from public.calendar_events o, public.calendar_events n where o.id = :'sync' and n.id = :'noon';
select 'bob is busy: ' || :busy;
-- The series ends before the 23rd.
select 'ended before the 23rd: ' || (public.end_calendar_series(:'noon', '2030-01-23') ->> 'ok');
select '… then: ' || :days;
-- Ending from the first day is cancelling the event.
select 'ended from its first day: ' || (public.end_calendar_series(:'noon', '2030-01-21') ->> 'ok');
select '… cancelled: ' || (select deleted_at is not null from public.calendar_events where id = :'noon');
-- "All events": a new time for every day; the days changed one by one start afresh.
select 'all days at 09:00: ' || (public.update_calendar_event(:'sync', (:'base'::jsonb || '{"title": "Sync", "starts_at": "2030-01-07T07:00:00Z", "ends_at": "2030-01-07T08:00:00Z", "repeat": {"freq": "weekly", "days": [1, 3], "until": "2030-01-20"}}')::jsonb) ->> 'ok');
select '… then: ' || :days;
select 'no longer repeats: ' || (public.update_calendar_event(:'sync', (:'base'::jsonb || '{"title": "Sync", "starts_at": "2030-01-07T07:00:00Z", "ends_at": "2030-01-07T08:00:00Z"}')::jsonb) ->> 'ok');
select '… then: ' || :days;

-- A private series: the owner sees no days of it, only when Bob is busy.
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Private daily", "visibility": "private", "starts_at": "2030-02-04T08:00:00Z", "ends_at": "2030-02-04T08:30:00Z", "repeat": {"freq": "daily", "count": 3}}')::jsonb, '{}') ->> 'id' as secret \gset
select 'the 5th is cancelled: ' || (public.cancel_calendar_occurrence(:'secret', '2030-02-05', false) ->> 'ok');
set request.jwt.claim.sub = :'alice';
select 'alice sees: ' || :days || '; bob is busy: ' || :busy || '; cancels a day of it: ' || (public.cancel_calendar_occurrence(:'secret', '2030-02-06', false) ->> 'error');
select 'the same events as the table gives: ' || ((select array_agg(distinct (x ->> 'id')::uuid order by (x ->> 'id')::uuid) from jsonb_array_elements(public.calendar_events_in(:'ws', '2030-01-01', '2030-02-10')) x)
  = (select array_agg(e.id order by e.id) from public.calendar_events e where e.workspace_id = :'ws' and e.deleted_at is null));

-- Nobody writes changed days directly.
set request.jwt.claim.sub = :'bob';
insert into public.calendar_event_exceptions (event_id, workspace_id, occurrence_date, cancelled) values (:'secret', :'ws', '2030-02-06', true);
delete from public.calendar_event_exceptions;

-- Reminders: once per event and start, for its people only, unless muted.
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'Soon', 'starts_at', now() + interval '5 minutes', 'ends_at', now() + interval '35 minutes', 'reminder_minutes', 10))::jsonb, array[:'carl']::uuid[]) ->> 'id' as soon \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'Daily soon', 'time_zone', 'UTC', 'starts_at', now() - interval '2 days' + interval '6 minutes', 'ends_at', now() - interval '2 days' + interval '30 minutes', 'reminder_minutes', 10, 'repeat', jsonb_build_object('freq', 'daily')))::jsonb, '{}') ->> 'id' as daily \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'In an hour', 'starts_at', now() + interval '50 minutes', 'ends_at', now() + interval '80 minutes', 'reminder_minutes', 10))::jsonb, '{}') ->> 'id' as later \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'No reminder', 'starts_at', now() + interval '5 minutes', 'ends_at', now() + interval '35 minutes'))::jsonb, '{}') ->> 'id' as silent \gset
select 'bob is reminded of: ' || public.calendar_remind_me(:'ws') || ', asked again: ' || public.calendar_remind_me(:'ws');
select 'bob hears: ' || string_agg(n #>> '{event,title}', ', ' order by n #>> '{event,title}') || ' — the series with the time of today''s day: '
  || bool_and((n #>> '{event,starts_at}')::timestamptz > now()) from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') n where n ->> 'kind' = 'event_reminder';
set request.jwt.claim.sub = :'carl';
select 'carl (invited to one) is reminded of: ' || public.calendar_remind_me(:'ws');
set request.jwt.claim.sub = :'alice';
select 'alice (in none of them) is reminded of: ' || public.calendar_remind_me(:'ws');
select 'alice mutes reminders: ' || (public.set_notification_prefs(:'ws', '{event_reminder}') ->> 'ok');
select 'she joins one and is reminded of: ' || (public.respond_to_calendar_event(:'soon', 'accepted') ->> 'status') || ' ' || public.calendar_remind_me(:'ws');
set request.jwt.claim.sub = :'eve';
select 'eve is reminded of: ' || public.calendar_remind_me(:'ws');

reset role;
select 'anon reads changed days: ' || has_table_privilege('anon', 'public.calendar_event_exceptions', 'select') || ', anon opens an event: ' || has_function_privilege('anon', 'public.calendar_event_details(uuid, date)', 'execute')
  || ', members call calendar_series: ' || has_function_privilege('authenticated', 'public.calendar_series(timestamptz, timestamptz, text, text, integer, smallint[], date, timestamptz, timestamptz)', 'execute');
