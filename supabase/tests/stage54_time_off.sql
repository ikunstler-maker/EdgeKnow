-- Doba, phase 1b: time off — who manages policies, the yearly accrual pressed twice,
-- balance and overlap checks, approval up the unit tree, cancelling, what colleagues,
-- a guest and an outsider see, notifications, direct writes.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000054a1', 'alice@off.test', now()),
 ('00000000-0000-0000-0000-0000000054b1', 'bob@off.test', now()),
 ('00000000-0000-0000-0000-0000000054c1', 'carol@off.test', now()),
 ('00000000-0000-0000-0000-0000000054d1', 'dave@off.test', now()),
 ('00000000-0000-0000-0000-000000005401', 'hank@off.test', now()),
 ('00000000-0000-0000-0000-0000000054e1', 'gwen@client-off.test', now()),
 ('00000000-0000-0000-0000-0000000054f1', 'eve@other-off.test', now());
\set alice '00000000-0000-0000-0000-0000000054a1'
\set bob '00000000-0000-0000-0000-0000000054b1'
\set carol '00000000-0000-0000-0000-0000000054c1'
\set dave '00000000-0000-0000-0000-0000000054d1'
\set hank '00000000-0000-0000-0000-000000005401'
\set gwen '00000000-0000-0000-0000-0000000054e1'
\set eve '00000000-0000-0000-0000-0000000054f1'
\set frank '00000000-0000-0000-0000-000000005402'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Time off') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'off.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-off.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
-- Units: Marketing (Carol leads) > Design (Bob and Dave). Hank is HR by a role.
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Marketing', null) ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design', :'marketing') ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'marketing', :'carol', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'marketing', :'carol', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'dave', true) ->> 'ok' as ignored \gset
select public.save_workspace_role(:'ws', null, 'HR', '{"manage_leave": true, "nonsense": true}', null) ->> 'id' as hr \gset
select 'the role keeps the right: ' || (select permissions::text from public.workspace_roles where id = :'hr');
select public.set_member_custom_role(:'ws', :'hank', :'hr') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- Dates: next year (always ahead), from the first Monday of July.
select extract(year from now())::int + 1 as y \gset
select (d + ((8 - extract(isodow from d)::int) % 7))::date as mon from (select make_date(:y, 7, 1) as d) x \gset
\set day '(:''mon''::date + '
\set numbers '(select (x ->> ''granted'') || '' given, '' || (x ->> ''used'') || '' used, '' || (x ->> ''pending'') || '' waiting'' from jsonb_array_elements(public.my_leave(:''ws'', :y) -> ''policies'') x where x ->> ''kind'' = ''vacation'')'

-- Policies: only who manages time off.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob seeds the policies: ' || (public.seed_leave_policies(:'ws', '{"vacation": "Vacation", "sick": "Sick leave", "day_off": "Day off", "remote": "Remote work"}') ->> 'error');
set request.jwt.claim.sub = :'hank';
select 'hank (HR) seeds: ' || (public.seed_leave_policies(:'ws', '{"vacation": "Vacation", "sick": "Sick leave", "day_off": "Day off", "remote": "Remote work"}') ->> 'created')
  || ', again: ' || (public.seed_leave_policies(:'ws', '{"vacation": "V", "sick": "S", "day_off": "D", "remote": "R"}') ->> 'created');
select 'seeded: ' || string_agg(name || ' ' || days_per_year || case when unlimited then ' unlimited' else '' end || case when requires_approval then ' approval' else '' end, ', ' order by position) from public.leave_policies;
select id as vacation from public.leave_policies where kind = 'vacation' \gset
select id as remote from public.leave_policies where kind = 'remote' \gset
select id as dayoff from public.leave_policies where kind = 'day_off' \gset
set request.jwt.claim.sub = :'bob';
select 'bob changes a policy: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Mine", "kind": "vacation", "days_per_year": 300}') ->> 'error')
  || ', accrues: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'error')
  || ', corrects his balance: ' || (public.adjust_leave_balance(:'ws', :'vacation', :'bob', :y, 50, 'please') ->> 'error')
  || ', reads the sheet: ' || (public.leave_balance_sheet(:'ws', :y) ->> 'error');
set request.jwt.claim.sub = :'hank';
select 'hank sets 10 days, 5 carried over: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 10, "carry_over_max": 5}') ->> 'ok')
  || ', a third of a day: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 10.3}') ->> 'error');
select 'day off needs a deputy: ' || (public.save_leave_policy(:'ws', :'dayoff', '{"name": "Day off", "kind": "day_off", "days_per_year": 3, "requires_deputy": true}') ->> 'ok');

-- Nothing accrued yet: a limited policy refuses, an unlimited one doesn't.
set request.jwt.claim.sub = :'bob';
select 'bob asks before any accrual: ' || (public.request_leave(:'ws', :'vacation', :day 0), :day 4), null, null, '') ->> 'error');

-- "Accrue for the year": this year, then the next one (with what is left, up to the limit). Pressed twice.
set request.jwt.claim.sub = :'hank';
select 'this year: ' || (public.accrue_leave_year(:'ws', :'vacation', :y - 1) ->> 'added') || ' people, again: ' || (public.accrue_leave_year(:'ws', :'vacation', :y - 1) ->> 'added');
select 'next year: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'added') || ' people, again: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'added')
  || ', the year after: ' || (public.accrue_leave_year(:'ws', :'vacation', :y + 1) ->> 'error');
select 'day off: ' || (public.accrue_leave_year(:'ws', :'dayoff', :y) ->> 'added');
-- Someone new joins: only they get it.
reset role;
insert into auth.users (id, email, email_confirmed_at) values (:'frank', 'frank@off.test', now());
set role authenticated;
set request.jwt.claim.sub = :'frank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select 'after frank joined: ' || (public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'added') || ' more';
select 'ledger rows of next year: ' || string_agg(kind || ' x' || n || ' (' || days || ')', ', ' order by kind)
from (select kind, count(*) as n, min(days) || '..' || max(days) as days from public.leave_balances where policy_id = :'vacation' and year = :y group by kind) x;

-- Bob: 10 + 5 carried over = 15.
set request.jwt.claim.sub = :'bob';
select 'bob has: ' || :numbers;
select public.request_leave(:'ws', :'vacation', :day 0), :day 4), null, :'dave', 'Sea') as made \gset
select 'bob asks Mon–Fri: ' || (:'made'::jsonb ->> 'status') || ', ' || (:'made'::jsonb ->> 'days') || ' days';
select :'made'::jsonb ->> 'id' as week1 \gset
select 'the same days again: ' || (public.request_leave(:'ws', :'vacation', :day 2), :day 3), null, null, '') ->> 'error')
  || ', another policy over them: ' || (public.request_leave(:'ws', :'remote', :day 4), :day 4), null, null, '') ->> 'error');
select 'a weekend only: ' || (public.request_leave(:'ws', :'vacation', :day 5), :day 6), null, null, '') ->> 'error')
  || ', across the new year: ' || (public.request_leave(:'ws', :'vacation', make_date(:y, 12, 30), make_date(:y + 1, 1, 2), null, null, '') ->> 'error')
  || ', half of two days: ' || (public.request_leave(:'ws', :'vacation', :day 7), :day 8), 'first', null, '') ->> 'error');
-- Waiting requests count: 5 wait, 11 more would pass 15.
select 'eleven more days while five wait: ' || (public.request_leave(:'ws', :'vacation', :day 7), :day 21), null, null, '') ->> 'error');
select 'ten more: ' || (public.request_leave(:'ws', :'vacation', :day 7), :day 18), null, null, '') ->> 'days');
select 'bob now: ' || :numbers;
select 'even half a day more: ' || (public.request_leave(:'ws', :'vacation', :day 21), :day 21), 'first', null, '') ->> 'error');
-- Halves of one day (day off, 3 days): the same half twice is an overlap, the other half is fine.
select 'no deputy: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'first', null, '') ->> 'error')
  || ', himself as deputy: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'first', :'bob', '') ->> 'error')
  || ', a guest as deputy: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'first', :'gwen', '') ->> 'error');
select 'first half: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'first', :'dave', '') ->> 'days')
  || ', first half again: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'first', :'dave', '') ->> 'error')
  || ', second half: ' || (public.request_leave(:'ws', :'dayoff', :day 28), :day 28), 'second', :'dave', '') ->> 'days');
-- Remote work: no norm, no approval — active at once.
select public.request_leave(:'ws', :'remote', :day 35), :day 36), null, :'dave', '') as made \gset
select 'remote, norm 0: ' || (:'made'::jsonb ->> 'status');

-- Who sees Bob's requests and balance.
\set sees '(select count(*) from public.leave_requests where user_id = :''bob'') || '' requests, '' || (select count(*) from public.leave_balances where user_id = :''bob'') || '' ledger rows'''
select 'bob sees of his own: ' || :sees;
set request.jwt.claim.sub = :'dave';
select 'dave (same unit, his deputy) sees: ' || :sees || ', inbox: ' || jsonb_array_length(public.leave_inbox(:'ws'));
set request.jwt.claim.sub = :'carol';
select 'carol (lead of the unit above) sees: ' || :sees || ', inbox waiting: ' || (select count(*) from jsonb_array_elements(public.leave_inbox(:'ws')) x where x ->> 'status' = 'pending');
set request.jwt.claim.sub = :'hank';
select 'hank (HR) sees: ' || :sees;
set request.jwt.claim.sub = :'alice';
select 'alice (owner) sees: ' || :sees;
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest) sees: ' || :sees || ', policies: ' || (select count(*) from public.leave_policies) || ', her page: ' || (public.my_leave(:'ws', :y) ->> 'error')
  || ', absences: ' || jsonb_array_length(public.team_absences(:'ws', :day 0), :day 60))) || ', asks: ' || (public.request_leave(:'ws', :'remote', :day 0), :day 0), null, null, '') ->> 'error');
set request.jwt.claim.sub = :'eve';
select 'eve (outsider) sees: ' || :sees || ', policies: ' || (select count(*) from public.leave_policies) || ', absences: ' || jsonb_array_length(public.team_absences(:'ws', :day 0), :day 60)))
  || ', overlaps: ' || jsonb_array_length(public.leave_unit_overlaps(:'ws', :'bob', :day 0), :day 4), null)) || ', decides: ' || (public.decide_leave_request(:'week1', true, '') ->> 'error');

-- Deciding: never one's own, not a colleague; the lead above; the first decision stands.
set request.jwt.claim.sub = :'bob';
select 'bob approves his own: ' || (public.decide_leave_request(:'week1', true, '') ->> 'error');
set request.jwt.claim.sub = :'dave';
select 'dave approves: ' || (public.decide_leave_request(:'week1', true, '') ->> 'error') || ', cancels: ' || (public.cancel_leave_request(:'week1') ->> 'error');
-- The hint for who decides: Dave of the same unit asks for the same week.
select 'dave asks the same week: ' || (public.request_leave(:'ws', :'vacation', :day 1), :day 2), null, null, '') ->> 'status');
select 'dave is told who else is off: ' || (select string_agg(x ->> 'name' || ' ' || (x ->> 'status'), ', ' order by x ->> 'start_date', x ->> 'status') from jsonb_array_elements(public.leave_unit_overlaps(:'ws', :'dave', :day 1), :day 2), null)) x);
select 'dave asks about bob: ' || jsonb_array_length(public.leave_unit_overlaps(:'ws', :'bob', :day 0), :day 4), null));
set request.jwt.claim.sub = :'carol';
select 'carol is told about bob''s week: ' || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(public.leave_unit_overlaps(:'ws', :'bob', :day 0), :day 4), :'week1')) x);
select 'carol approves: ' || (public.decide_leave_request(:'week1', true, 'Have a rest') ->> 'ok');
set request.jwt.claim.sub = :'hank';
select 'hank decides again: ' || (public.decide_leave_request(:'week1', false, '') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob after the approval: ' || :numbers;
-- Carol leads the top unit: nobody above her, so the owner and HR hear; she can't approve herself.
set request.jwt.claim.sub = :'carol';
select public.request_leave(:'ws', :'vacation', :day 7), :day 8), null, null, '') ->> 'id' as carols \gset
select 'carol approves her own: ' || (public.decide_leave_request(:'carols', true, '') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice approves carol''s: ' || (public.decide_leave_request(:'carols', true, '') ->> 'ok');

-- What colleagues see: who, when, the deputy; the kind only when the policy shows it.
set request.jwt.claim.sub = :'frank';
select 'frank (another colleague) sees: ' || string_agg(split_part(x ->> 'person', '@', 1) || ' ' || coalesce(x ->> 'label', case when (x ->> 'remote')::boolean then 'remote' else 'absent' end)
  || coalesce(' / deputy ' || split_part(x ->> 'deputy', '@', 1), ''), ', ' order by x ->> 'start_date', x ->> 'person')
  || ' — keys: ' || (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.team_absences(:'ws', :day 0), :day 60))) y, jsonb_object_keys(y) k)
from jsonb_array_elements(public.team_absences(:'ws', :day 0), :day 60))) x;
set request.jwt.claim.sub = :'carol';
select 'carol (decides for bob) sees: ' || string_agg(split_part(x ->> 'person', '@', 1) || ' ' || coalesce(x ->> 'label', 'absent'), ', ' order by x ->> 'start_date', x ->> 'person')
from jsonb_array_elements(public.team_absences(:'ws', :day 0), :day 60))) x;

-- Cancelling an approved request: the person before it starts — the days come back.
set request.jwt.claim.sub = :'bob';
select 'bob cancels his approved week: ' || (public.cancel_leave_request(:'week1') ->> 'ok') || ', again: ' || (public.cancel_leave_request(:'week1') ->> 'error');
select 'bob after cancelling: ' || :numbers;
-- One that has started: only who decides.
select public.request_leave(:'ws', :'remote', :day 42), :day 42), null, null, '') ->> 'id' as started \gset
reset role;
update public.leave_requests set start_date = current_date - 3, end_date = current_date - 3 where id = :'started' and extract(year from current_date - 3) = extract(year from current_date);
update public.leave_requests set start_date = current_date, end_date = current_date where id = :'started' and start_date > current_date;
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob cancels one that has started: ' || (public.cancel_leave_request(:'started') ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol cancels it: ' || (public.cancel_leave_request(:'started') ->> 'ok');

-- A correction always has a reason and never touches old rows.
set request.jwt.claim.sub = :'hank';
select 'hank adds 2 days: ' || (public.adjust_leave_balance(:'ws', :'vacation', :'bob', :y, 2, 'Worked on a holiday') ->> 'ok')
  || ', without a reason: ' || (public.adjust_leave_balance(:'ws', :'vacation', :'bob', :y, 2, ' ') ->> 'error')
  || ', to a guest: ' || (public.adjust_leave_balance(:'ws', :'vacation', :'gwen', :y, 2, 'x') ->> 'error');
select 'the sheet has: ' || jsonb_array_length(public.leave_balance_sheet(:'ws', :y) -> 'people') || ' people, bob: '
  || (select p #>> array['numbers', :'vacation', 'granted'] from jsonb_array_elements(public.leave_balance_sheet(:'ws', :y) -> 'people') p where p ->> 'id' = :'bob');

-- Nobody writes the tables directly.
set request.jwt.claim.sub = :'hank';
insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days) values (:'ws', :'vacation', :'hank', :y, 'accrual', 99);
update public.leave_requests set status = 'approved';
delete from public.leave_policies;

-- Notifications: who decides hears of a request, the person of the decision, the deputy when it is on.
\set hears '(select coalesce(string_agg(k || '' x'' || n, '', '' order by k), ''nothing'') from (select x ->> ''kind'' as k, count(*) as n from jsonb_array_elements(public.my_notifications(:''ws'', 100) -> ''items'') x where x -> ''leave'' <> ''null'' group by 1) q)'
set request.jwt.claim.sub = :'carol';
select 'carol hears: ' || :hears;
set request.jwt.claim.sub = :'bob';
select 'bob hears: ' || :hears;
set request.jwt.claim.sub = :'dave';
select 'dave (deputy) hears: ' || :hears || ' — sees of it: ' || (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.my_notifications(:'ws', 100) -> 'items') x, jsonb_object_keys(x -> 'leave') k where x -> 'leave' <> 'null');
set request.jwt.claim.sub = :'alice';
select 'alice hears: ' || :hears;
set request.jwt.claim.sub = :'frank';
select 'frank hears: ' || :hears || ', mutes: ' || (public.set_notification_prefs(:'ws', '{leave_request,leave_info}') ->> 'ok');

reset role;
select 'people for the move include hank: ' || exists (select 1 from jsonb_array_elements(public.team_move_people(:'ws')) p where p ->> 'id' = :'hank');
select 'anon reads: ' || has_table_privilege('anon', 'public.leave_requests', 'select') || ', anon calls: ' || has_function_privilege('anon', 'public.team_absences(uuid, date, date)', 'execute')
  || ', members call leave_can_decide: ' || has_function_privilege('authenticated', 'public.leave_can_decide(uuid, uuid, uuid)', 'execute');
-- A policy with requests stays; a workspace that goes takes its time off with it.
delete from public.leave_policies where id = :'vacation';
delete from public.workspaces where id = :'ws';
select 'after the workspace is gone: ' || (select count(*) from public.leave_requests where workspace_id = :'ws') || ' requests, ' || (select count(*) from public.leave_policies where workspace_id = :'ws') || ' policies';
