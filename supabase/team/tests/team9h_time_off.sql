-- Time off in a team database: policies by the owner, a request and its approval,
-- what a colleague, a guest and a stranger see.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set gwen '00000000-0000-0000-0000-0000000000e1'
\set dora '00000000-0000-0000-0000-0000000000d7'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_gwen 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e1","email":"gwen@client.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_dora 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000d7''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"dora@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
select extract(year from now())::int + 1 as y \gset
select (d + ((8 - extract(isodow from d)::int) % 7))::date as mon from (select make_date(:y, 7, 1) as d) x \gset
\set sees '(select count(*) from public.leave_requests) || '' requests, '' || (select count(*) from public.leave_balances) || '' ledger rows, '' || (select count(*) from public.leave_policies) || '' policies, '' || jsonb_array_length(public.team_absences(:''ws'', :''mon''::date, :''mon''::date + 30)) || '' absences'''

set role service_role;
select 'sync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'profiles', jsonb_build_array(jsonb_build_object('id', :'gwen', 'email', 'gwen@client.test', 'name', 'Gwen'), jsonb_build_object('id', :'dora', 'email', 'dora@team.test', 'name', 'Dora')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'dora', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days'))
)) ->> 'ok');
reset role;

set role authenticated;
:as_bob;
select 'bob seeds: ' || (public.seed_leave_policies(:'ws', '{"vacation": "Vacation", "sick": "Sick leave", "day_off": "Day off", "remote": "Remote work"}') ->> 'error');
reset role;
set role authenticated;
:as_alice;
select 'alice seeds: ' || (public.seed_leave_policies(:'ws', '{"vacation": "Vacation", "sick": "Sick leave", "day_off": "Day off", "remote": "Remote work"}') ->> 'created');
select id as vacation from public.leave_policies where kind = 'vacation' \gset
select 'ten days: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 10}') ->> 'ok')
  || ', accrued: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'added') || ', again: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'added');
reset role;
set role authenticated;
:as_bob;
select public.request_leave(:'ws', :'vacation', :'mon'::date, :'mon'::date + 4, null, :'dora', '') as made \gset
select 'bob asks a week: ' || (:'made'::jsonb ->> 'status') || ' ' || (:'made'::jsonb ->> 'days') || ', twelve days more: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date + 7, :'mon'::date + 22, null, null, '') ->> 'error')
  || ', approves himself: ' || (public.decide_leave_request((:'made'::jsonb ->> 'id')::uuid, true, '') ->> 'error');
select :'made'::jsonb ->> 'id' as req \gset
reset role;
set role authenticated;
:as_dora;
select 'dora (colleague, deputy) sees: ' || :sees || ', approves: ' || (public.decide_leave_request(:'req', true, '') ->> 'error');
reset role;
set role authenticated;
:as_alice;
select 'alice approves: ' || (public.decide_leave_request(:'req', true, '') ->> 'ok');
reset role;
set role authenticated;
:as_dora;
select 'dora now sees: ' || :sees || ' — ' || (select (x ->> 'person') || ' ' || coalesce(x ->> 'label', 'absent') from jsonb_array_elements(public.team_absences(:'ws', :'mon'::date, :'mon'::date + 30)) x)
  || ', hears: ' || (select string_agg(x ->> 'kind', ',') from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') x where x -> 'leave' <> 'null');
reset role;
set role authenticated;
:as_gwen;
select 'gwen (guest) sees: ' || :sees || ', asks: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date, :'mon'::date, null, null, '') ->> 'error');
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees: ' || :sees || ', cancels: ' || (public.cancel_leave_request(:'req') ->> 'error');
update public.leave_requests set status = 'rejected';
reset role;
