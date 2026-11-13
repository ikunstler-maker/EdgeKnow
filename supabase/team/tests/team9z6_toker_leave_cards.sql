-- Toker leave cards in a team database: a request waiting for a decision becomes a
-- system message in the requester's conversation with the deciders (here the owner).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
select extract(year from now())::int + 1 as y \gset
select (d + ((8 - extract(isodow from d)::int) % 7))::date + 70 as mon from (select make_date(:y, 7, 1) as d) x \gset

set role authenticated;
:as_alice;
select public.save_leave_policy(:'ws', null, '{"name": "Study leave", "kind": "vacation", "unlimited": true, "requires_approval": true}') ->> 'id' as study \gset
reset role;
set role authenticated;
:as_bob;
select public.request_leave(:'ws', :'study', :'mon'::date, :'mon'::date + 1, null, null, '') ->> 'id' as req \gset
select 'bob asks: ' || (select status from public.leave_requests where id = :'req');
select 'his card: ' || (select count(*) from public.chat_messages where kind = 'system' and leave_request_id = :'req');
select id as card from public.chat_messages where leave_request_id = :'req' \gset
select 'he edits it: ' || (public.chat_edit_message(:'card', 'x', null) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice sees it: ' || (select count(*) from public.chat_messages where id = :'card');
select 'alice approves: ' || (public.decide_leave_request(:'req', true, '') ->> 'ok');
select 'the request: ' || (select status from public.leave_requests where id = :'req');
reset role;
