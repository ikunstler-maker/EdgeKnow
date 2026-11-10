-- Doba, phase 2c: holidays (not taken from the balance by working-day policies), the
-- norm in proportion for who started within the year, monthly parts that add up to the
-- norm exactly, accrual that never gives twice, who sees a start date.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000058a1', 'alice@hol.test', now()),
 ('00000000-0000-0000-0000-0000000058b1', 'bob@hol.test', now()),
 ('00000000-0000-0000-0000-0000000058c1', 'carol@hol.test', now()),
 ('00000000-0000-0000-0000-000000005801', 'hank@hol.test', now()),
 ('00000000-0000-0000-0000-0000000058e1', 'gwen@client-hol.test', now()),
 ('00000000-0000-0000-0000-0000000058f1', 'eve@other-hol.test', now());
\set alice '00000000-0000-0000-0000-0000000058a1'
\set bob '00000000-0000-0000-0000-0000000058b1'
\set carol '00000000-0000-0000-0000-0000000058c1'
\set hank '00000000-0000-0000-0000-000000005801'
\set gwen '00000000-0000-0000-0000-0000000058e1'
\set eve '00000000-0000-0000-0000-0000000058f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Holidays') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'hol.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-hol.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
-- Carol leads Bob's unit (she decides on his time off but doesn't manage it); Hank is HR.
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Team', null) ->> 'id' as team \gset
select public.set_workspace_group_member(:'ws', :'team', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'team', :'carol', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'team', :'carol', true) ->> 'ok' as ignored \gset
select public.save_workspace_role(:'ws', null, 'HR', '{"manage_leave": true}', null) ->> 'id' as hr \gset
select public.set_member_custom_role(:'ws', :'hank', :'hr') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = :'hank';
select public.save_leave_policy(:'ws', null, '{"name": "Vacation", "kind": "vacation", "days_per_year": 20, "carry_over_max": 3, "requires_approval": false}') ->> 'id' as vacation \gset
select public.save_leave_policy(:'ws', null, '{"name": "Calendar leave", "kind": "other", "days_per_year": 30, "count_days": "calendar", "requires_approval": false, "allow_negative": true}') ->> 'id' as calendar \gset
select 'a way of accrual nobody knows: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 20, "accrual": "weekly"}') ->> 'error')
  || ', monthly: ' || (public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 20, "carry_over_max": 3, "requires_approval": false, "accrual": "monthly"}') ->> 'ok');

-- Start dates: only who manages time off sets them; the person sees their own; a lead doesn't see them.
set request.jwt.claim.sub = :'bob';
select 'bob sets his own start date: ' || (public.set_leave_start_date(:'ws', :'bob', '2020-01-01') ->> 'error');
set request.jwt.claim.sub = :'hank';
select 'hank sets: bob from 28 March 2031: ' || (public.set_leave_start_date(:'ws', :'bob', '2031-03-28') ->> 'ok')
  || ', carol from 2030: ' || (public.set_leave_start_date(:'ws', :'carol', '2030-06-01') ->> 'ok')
  || ', a guest: ' || (public.set_leave_start_date(:'ws', :'gwen', '2031-01-01') ->> 'error');
select 'hank sees start dates: ' || (select count(*) from public.leave_member_settings);
set request.jwt.claim.sub = :'bob';
select 'bob sees: ' || (select string_agg(started_on::text, ',') from public.leave_member_settings) || ' — on his page: ' || (public.my_leave(:'ws', 2031) ->> 'started_on');
set request.jwt.claim.sub = :'carol';
select 'carol (bob''s lead) sees: ' || (select string_agg(started_on::text, ',') from public.leave_member_settings);
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest) sees: ' || (select count(*) from public.leave_member_settings) || ' start dates, ' || (select count(*) from public.leave_holidays) || ' holidays';
set request.jwt.claim.sub = :'eve';
select 'eve (outsider) sees: ' || (select count(*) from public.leave_member_settings) || ' start dates';

-- The norm for 2031 (20 days): whole, in proportion (March to December = 10 of 12, rounded up to half a day), nothing before the start.
reset role;
select 'norm 2031 — alice (no date): ' || public.leave_norm(:'vacation', :'alice', 2031) || ', carol (since 2030): ' || public.leave_norm(:'vacation', :'carol', 2031)
  || ', bob (since March 2031): ' || public.leave_norm(:'vacation', :'bob', 2031) || ', bob in 2030: ' || public.leave_norm(:'vacation', :'bob', 2030) || ', bob in 2032: ' || public.leave_norm(:'vacation', :'bob', 2032);
update public.leave_member_settings set started_on = '2031-07-15' where user_id = :'carol';
select 'from July (6 of 12 of 20): ' || public.leave_norm(:'vacation', :'carol', 2031) || ', of 30: ' || public.leave_norm(:'calendar', :'carol', 2031);
update public.leave_member_settings set started_on = '2031-12-31' where user_id = :'carol';
select 'from 31 December (1 of 12 of 20 = 1.67): ' || public.leave_norm(:'vacation', :'carol', 2031);
update public.leave_member_settings set started_on = '2030-06-01' where user_id = :'carol';

-- Monthly parts through the year: the running total is rounded, the year adds up exactly.
select 'alice, month by month: ' || string_agg(public.leave_accrue_person(:'vacation', :'alice', 2031, m, true, null)::text, ' ' order by m) from generate_series(1, 12) m;
select 'alice''s year: ' || sum(days) || ' in ' || count(*) || ' rows' from public.leave_balances where policy_id = :'vacation' and user_id = :'alice' and year = 2031;
select 'bob (from March), month by month: ' || string_agg(public.leave_accrue_person(:'vacation', :'bob', 2031, m, true, null)::text, ' ' order by m) from generate_series(1, 12) m;
select 'bob''s year: ' || sum(days) || ' in ' || count(*) || ' rows' from public.leave_balances where policy_id = :'vacation' and user_id = :'bob' and year = 2031;
select 'the whole year again: ' || sum(public.leave_accrue_person(:'vacation', :'alice', 2031, m, true, null)) from generate_series(1, 12) m;
-- A missed month is made up; the way of accrual changed in the middle of a year gives only the difference.
select 'carol: May after nothing: ' || public.leave_accrue_person(:'vacation', :'carol', 2031, 5, true, null) || ', then yearly: ' || public.leave_accrue_person(:'vacation', :'carol', 2031, 5, false, null)
  || ', then monthly in June: ' || public.leave_accrue_person(:'vacation', :'carol', 2031, 6, true, null);
select 'carol''s year: ' || sum(days) || ' as ' || string_agg(kind || ' ' || days, ', ' order by created_at, kind) from public.leave_balances where policy_id = :'vacation' and user_id = :'carol' and year = 2031;
-- Last year's rest comes with the first row of the next year, within the limit (3).
select 'alice in 2032, January: ' || public.leave_accrue_person(:'vacation', :'alice', 2032, 1, true, null);
select '… rows: ' || (select string_agg(kind || ' ' || days, ', ' order by kind) from public.leave_balances where policy_id = :'vacation' and user_id = :'alice' and year = 2032);

-- The daily run: every policy that accrues by itself, every member, nothing twice. Members can't call it.
select 'the daily run adds for: ' || (public.run_leave_accruals() > 0) || ', again: ' || public.run_leave_accruals();
select 'members may call it: ' || has_function_privilege('authenticated', 'public.run_leave_accruals()', 'execute') || ', the engine: ' || has_function_privilege('authenticated', 'public.leave_accrue_person(uuid, uuid, integer, integer, boolean, uuid)', 'execute');
-- The button on a monthly policy: this year only.
set role authenticated;
set request.jwt.claim.sub = :'hank';
select 'the button after the daily run: ' || (public.accrue_leave_year(:'ws', :'vacation', extract(year from now())::int) ->> 'added') || ', a monthly policy for next year: ' || (public.accrue_leave_year(:'ws', :'vacation', extract(year from now())::int + 1) ->> 'error');

-- Holidays. Dates: next year (always ahead), the week of the first Monday of July.
select extract(year from now())::int + 1 as y \gset
select (d + ((8 - extract(isodow from d)::int) % 7))::date as mon from (select make_date(:y, 7, 1) as d) x \gset
set request.jwt.claim.sub = :'bob';
select 'bob adds a holiday: ' || (public.save_leave_holiday(:'ws', :'mon'::date + 2, 'Mine') ->> 'error') || ', deletes: ' || (public.delete_leave_holiday(:'ws', :'mon'::date + 2) ->> 'error')
  || ', copies: ' || (public.copy_leave_holidays(:'ws', :y, :y + 1) ->> 'error');
set request.jwt.claim.sub = :'hank';
select public.adjust_leave_balance(:'ws', :'vacation', :'bob', :y, 15, 'For the test') ->> 'ok' as ignored \gset
-- A request made before the holiday exists keeps its days.
set request.jwt.claim.sub = :'bob';
select public.request_leave(:'ws', :'vacation', :'mon'::date + 7, :'mon'::date + 11, null, null, '') ->> 'id' as before \gset
set request.jwt.claim.sub = :'hank';
select 'hank adds a holiday (Wednesday): ' || (public.save_leave_holiday(:'ws', :'mon'::date + 2, 'Founders day') ->> 'ok') || ', the next Wednesday too: ' || (public.save_leave_holiday(:'ws', :'mon'::date + 9, 'Team day') ->> 'ok')
  || ', renames: ' || (public.save_leave_holiday(:'ws', :'mon'::date + 2, 'Founders'' day') ->> 'ok') || ', no name: ' || (public.save_leave_holiday(:'ws', :'mon'::date + 3, ' ') ->> 'error');
select 'holidays: ' || string_agg(name, ', ' order by day) from public.leave_holidays;
set request.jwt.claim.sub = :'bob';
select 'bob reads the holidays: ' || (select count(*) from public.leave_holidays);
select 'Mon–Fri with a holiday, working days: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date, :'mon'::date + 4, null, null, '') ->> 'days')
  || '; a week of calendar days: ' || (public.request_leave(:'ws', :'calendar', :'mon'::date + 14, :'mon'::date + 20, null, null, '') ->> 'days')
;
set request.jwt.claim.sub = :'hank';
select public.save_leave_holiday(:'ws', :'mon'::date + 23, 'Alone') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select 'half of a holiday: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date + 23, :'mon'::date + 23, 'first', null, '') ->> 'error')
  || ', Tue–Thu around it: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date + 22, :'mon'::date + 24, null, null, '') ->> 'days');
select 'the request made before the second holiday still takes: ' || days from public.leave_requests where id = :'before';
set request.jwt.claim.sub = :'carol';
select 'who decides sees how the days are counted: ' || (select string_agg(distinct x ->> 'count_days', ',' order by x ->> 'count_days') from jsonb_array_elements(public.leave_inbox(:'ws')) x)
  || '; absences say if only working days count: ' || (select string_agg(distinct x ->> 'working_only', ',' order by x ->> 'working_only') from jsonb_array_elements(public.team_absences(:'ws', :'mon'::date, :'mon'::date + 30)) x);
-- "The same as last year": same day and month; what is there stays; 29 February only in a leap year.
set request.jwt.claim.sub = :'hank';
select 'copied to the next year: ' || (public.copy_leave_holidays(:'ws', :y, :y + 1) ->> 'added') || ', again: ' || (public.copy_leave_holidays(:'ws', :y, :y + 1) ->> 'added')
  || ', to the same year: ' || (public.copy_leave_holidays(:'ws', :y, :y) ->> 'error');
select public.save_leave_holiday(:'ws', '2032-02-29', 'Leap day') ->> 'ok' as ignored \gset
select '29 February into 2033: ' || (public.copy_leave_holidays(:'ws', 2032, 2033) ->> 'added') || ', into 2036: ' || (public.copy_leave_holidays(:'ws', 2032, 2036) ->> 'added');
select 'deleted: ' || (public.delete_leave_holiday(:'ws', '2036-02-29') ->> 'ok');
select '… left in 2036: ' || (select count(*) from public.leave_holidays where extract(year from day) = 2036);
select 'the sheet shows start dates: ' || (select string_agg(coalesce(p ->> 'started_on', '-'), ' ' order by p ->> 'name') from jsonb_array_elements(public.leave_balance_sheet(:'ws', :y) -> 'people') p);

-- Nobody writes the tables directly.
insert into public.leave_holidays (workspace_id, day, name) values (:'ws', '2031-01-01', 'Direct');
update public.leave_member_settings set started_on = '2000-01-01';
reset role;
select 'anon reads: ' || has_table_privilege('anon', 'public.leave_holidays', 'select') || ' ' || has_table_privilege('anon', 'public.leave_member_settings', 'select')
  || ', people for the move include hank: ' || exists (select 1 from jsonb_array_elements(public.team_move_people(:'ws')) p where p ->> 'id' = :'hank');
