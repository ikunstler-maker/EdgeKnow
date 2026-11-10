-- Phase 2b in a team database: tasks with a due date as Rukh shows them (never another
-- person's private one), search and chips of events for those who see them.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set tasks '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_tasks(:''ws'', ''2032-05-01'', ''2032-05-31'', false)) x)'
\set same '(select case when (select coalesce(array_agg((x ->> ''id'')::uuid order by x ->> ''id''), ''{}'') from jsonb_array_elements(public.calendar_tasks(:''ws'', ''2032-05-01'', ''2032-05-31'', false)) x) = (select coalesce(array_agg(t.id order by t.id::text), ''{}'') from public.tasks t where t.workspace_id = :''ws'' and t.deleted_at is null and t.due_date between ''2032-05-01'' and ''2032-05-31'') then ''same as Rukh'' else ''DIFFERS'' end)'

set role authenticated;
:as_alice;
select public.create_task_project(:'ws', 'Calendar links', 'CLK', null, null) ->> 'id' as project \gset
reset role;
set role authenticated;
:as_bob;
select public.create_task(:'project', '{"title": "Team task", "due_date": "2032-05-10"}') ->> 'id' as ignored \gset
select public.create_task(:'project', '{"title": "Bob private", "due_date": "2032-05-10", "private": true}') ->> 'id' as ignored \gset
select public.create_calendar_event(:'ws', '{"title": "Team retro", "description": "", "location": "", "time_zone": "UTC", "all_day": false, "visibility": "private", "starts_at": "2032-05-10T10:00:00Z", "ends_at": "2032-05-10T11:00:00Z"}', '{}') ->> 'id' as retro \gset
select 'bob: ' || :tasks || ' — ' || :same || '; finds: ' || jsonb_array_length(public.search_calendar_events(:'ws', 'retro')) || ', chips: ' || jsonb_array_length(public.calendar_event_chips(array[:'retro']::uuid[]));
reset role;
set role authenticated;
:as_alice;
select 'alice (owner): ' || :tasks || ' — ' || :same || '; finds: ' || jsonb_array_length(public.search_calendar_events(:'ws', 'retro')) || ', chips: ' || jsonb_array_length(public.calendar_event_chips(array[:'retro']::uuid[]))
  || ', invites a unit to bob''s event: ' || (public.invite_unit_to_calendar_event(:'retro', gen_random_uuid()) ->> 'error');
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || :tasks || ' — ' || :same || '; finds: ' || jsonb_array_length(public.search_calendar_events(:'ws', 'retro')) || ', chips: ' || jsonb_array_length(public.calendar_event_chips(array[:'retro']::uuid[]));
reset role;
