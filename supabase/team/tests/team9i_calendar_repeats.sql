-- Repeating events in a team database: the days of a series, one cancelled, one moved,
-- "this and the following", free/busy, a stranger.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set base '{"description": "", "location": "", "time_zone": "UTC", "all_day": false, "visibility": "private"}'
\set days '(select coalesce(string_agg(x ->> ''title'' || '' '' || to_char((x ->> ''starts_at'')::timestamptz at time zone ''UTC'', ''DD HH24:MI''), '', '' order by x ->> ''starts_at''), ''nothing'') from jsonb_array_elements(public.calendar_events_in(:''ws'', ''2031-03-01'', ''2031-04-01'')) x)'
\set busy '(select coalesce(string_agg(to_char((b ->> ''starts_at'')::timestamptz at time zone ''UTC'', ''DD HH24:MI''), '', '' order by b ->> ''starts_at''), ''free'') from jsonb_array_elements(public.calendar_busy(:''ws'', array[:''bob'']::uuid[], ''2031-03-01'', ''2031-04-01'')) b)'

set role authenticated;
:as_bob;
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Daily", "starts_at": "2031-03-03T09:00:00Z", "ends_at": "2031-03-03T09:30:00Z", "repeat": {"freq": "daily", "count": 5}}')::jsonb, '{}') ->> 'id' as daily \gset
select 'five days: ' || :days;
select 'the 4th cancelled: ' || (public.cancel_calendar_occurrence(:'daily', '2031-03-04', false) ->> 'ok') || ', the 5th moved: '
  || (public.change_calendar_occurrence(:'daily', '2031-03-05', '{"title": "Daily", "starts_at": "2031-03-05T15:00:00Z", "ends_at": "2031-03-05T15:30:00Z"}') ->> 'ok');
select 'now: ' || :days;
select public.split_calendar_event(:'daily', '2031-03-06', (:'base'::jsonb || '{"title": "Later", "starts_at": "2031-03-06T11:00:00Z", "ends_at": "2031-03-06T11:30:00Z", "repeat": {"freq": "daily", "count": 5}}')::jsonb) ->> 'ok' as ignored \gset
select 'this and the following: ' || :days;
reset role;
set role authenticated;
:as_alice;
select 'alice (owner, private series) sees: ' || :days || '; bob is busy: ' || :busy || '; cancels a day: ' || (public.cancel_calendar_occurrence(:'daily', '2031-03-03', false) ->> 'error');
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees: ' || :days || '; busy: ' || :busy || '; changed days: ' || (select count(*) from public.calendar_event_exceptions) || '; reminded of: ' || public.calendar_remind_me(:'ws');
insert into public.calendar_event_exceptions (event_id, workspace_id, occurrence_date, cancelled) values (:'daily', :'ws', '2031-03-03', true);
reset role;
