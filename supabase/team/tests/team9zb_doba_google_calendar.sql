-- DOBA-1 in a team database: titles of outside events are the person's own; colleagues
-- get plain busy time for busy slots only; the list of a person's Doba events is for the
-- server alone. No connection or link tables here.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set far 'now() + interval ''70 days'', now() + interval ''80 days'''

select 'the link table here: ' || coalesce(to_regclass('public.calendar_external_links')::text, 'none');
set role authenticated;
:as_bob;
select 'bob lists his own events:';
select public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days');
reset role;
set role service_role;
select 'the server lists bob''s events: ' || jsonb_typeof(public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days'));
select 'the server keeps: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(
  jsonb_build_object('starts_at', now() + interval '75 days', 'ends_at', now() + interval '75 days 1 hour', 'title', 'Dentist', 'busy', true),
  jsonb_build_object('starts_at', now() + interval '76 days', 'ends_at', now() + interval '76 days 1 hour', 'title', 'Maybe lunch', 'busy', false)));
reset role;
set role authenticated;
:as_alice;
select 'alice sees bob busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], :far))
  || ', a title in it: ' || (public.calendar_busy(:'ws', array[:'bob']::uuid[], :far)::text ilike '%dentist%')
  || ', reads his rows: ' || (select count(*) from public.calendar_external_busy);
reset role;
set role authenticated;
:as_bob;
select 'bob reads his own: ' || (select string_agg(title || '/' || busy, ', ' order by starts_at) from public.calendar_external_busy);
reset role;
set role service_role;
select 'cleared: ' || public.set_calendar_external_busy(:'ws', :'bob', '[]');
reset role;
