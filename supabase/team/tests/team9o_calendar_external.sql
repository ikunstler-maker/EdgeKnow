-- Phase 3b in a team database: outside busy time is written by the server alone, shown
-- to colleagues as anonymous busy slots, and to a stranger not at all. No address table here.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set far 'now() + interval ''70 days'', now() + interval ''80 days'''

select 'the address table here: ' || coalesce(to_regclass('public.calendar_connections')::text, 'none');
set role authenticated;
:as_bob;
select 'bob writes his own slots:';
select public.set_calendar_external_busy(:'ws', :'bob', '[]');
reset role;
set role authenticated;
:as_alice;
select 'alice sees bob busy before: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], :far));
reset role;
set role service_role;
select 'the server keeps: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '75 days', 'ends_at', now() + interval '75 days 1 hour')));
reset role;
set role authenticated;
:as_alice;
select 'alice sees bob busy after: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], :far)) || ', reads his rows: ' || (select count(*) from public.calendar_external_busy);
reset role;
set role authenticated;
:as_bob;
select 'bob reads his own rows: ' || (select count(*) from public.calendar_external_busy);
reset role;
set role authenticated;
:as_zed;
select 'zed (not a member) sees bob busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], :far)) || ', rows: ' || (select count(*) from public.calendar_external_busy);
reset role;
set role service_role;
select 'cleared: ' || public.set_calendar_external_busy(:'ws', :'bob', '[]');
select 'rows left: ' || (select count(*) from public.calendar_external_busy);
reset role;
