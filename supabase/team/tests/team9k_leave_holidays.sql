-- Phase 2c in a team database: holidays kept by the owner and not taken from the balance,
-- a start date with a norm in proportion, the daily accrual that gives nothing twice.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select 'bob adds a holiday: ' || (public.save_leave_holiday(:'ws', '2033-05-04', 'Mine') ->> 'error') || ', sets his start: ' || (public.set_leave_start_date(:'ws', :'bob', '2020-01-01') ->> 'error');
reset role;
set role authenticated;
:as_alice;
select public.save_leave_policy(:'ws', null, '{"name": "Paid leave", "kind": "other", "days_per_year": 24, "accrual": "yearly"}') ->> 'id' as paid \gset
select 'alice adds a holiday: ' || (public.save_leave_holiday(:'ws', '2033-05-04', 'Team day') ->> 'ok') || ', bob from October 2033: ' || (public.set_leave_start_date(:'ws', :'bob', '2033-10-10') ->> 'ok');
reset role;
select 'bob''s norm in 2033 (3 of 12 of 24): ' || public.leave_norm(:'paid', :'bob', 2033) || ', a week with the holiday: ' || public.leave_days(:'ws', 'working', '2033-05-02', '2033-05-06', null);
set role service_role;
select 'the daily run adds for: ' || (public.run_leave_accruals() > 0) || ', again: ' || public.run_leave_accruals();
reset role;
set role authenticated;
:as_bob;
select 'bob sees: ' || (select count(*) from public.leave_holidays) || ' holiday, start ' || (select string_agg(started_on::text, ',') from public.leave_member_settings);
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees: ' || (select count(*) from public.leave_holidays) || ' holidays, ' || (select count(*) from public.leave_member_settings) || ' start dates';
reset role;
