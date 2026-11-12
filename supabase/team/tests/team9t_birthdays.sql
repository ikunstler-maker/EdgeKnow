-- Birthdays in a team database: one's own is set and seen; a colleague sees day and month
-- (no year); a stranger sees nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set got 'jsonb_array_length(public.calendar_birthdays(:''ws'', ''2031-01-01'', ''2031-12-31''))'

set role authenticated;
:as_bob;
select 'bob sets his: ' || public.set_my_birthday(:'ws', 3, 14, 1990, true)::text;
select 'bob reads: ' || public.my_birthday(:'ws')::text;
reset role;
set role authenticated;
:as_alice;
select 'alice sees: ' || :got || ', the year in it: ' || (public.calendar_birthdays(:'ws', '2031-01-01', '2031-12-31')::text like '%1990%');
reset role;
set role authenticated;
:as_zed;
select 'zed (not a member) sees: ' || :got || ', sets one: ' || (public.set_my_birthday(:'ws', 1, 1, null, true) ->> 'error');
reset role;
set role authenticated;
:as_bob;
select 'bob clears his: ' || (public.set_my_birthday(:'ws', null, null, null, true) ->> 'ok');
reset role;
