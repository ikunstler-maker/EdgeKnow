-- Rukh 4-3: repeating tasks. A rule says every N days, weeks (on chosen days), months or
-- years; on each date a copy is made; a copy done early brings the next one at once.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

-- The dates a rule gives.
select 'every 3 days: ' || public.recurrence_after('2027-03-01', 3, 'day', '{}')
  || ', every 2 weeks: ' || public.recurrence_after('2027-03-01', 2, 'week', '{}')
  || ', every month from the 31st: ' || public.recurrence_after('2027-01-31', 1, 'month', '{}')
  || ', every 2 years: ' || public.recurrence_after('2027-03-01', 2, 'year', '{}');
-- 2027-03-01 is a Monday: Monday and Thursday every 2 weeks.
select 'Mon → Thu the same week: ' || public.recurrence_after('2027-03-01', 2, 'week', '{1,4}')
  || ', Thu → Mon two weeks on: ' || public.recurrence_after('2027-03-04', 2, 'week', '{1,4}');

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000071a1', 'alice@repeats.test', now()),
 ('00000000-0000-0000-0000-0000000071b1', 'bob@repeats.test', now()),
 ('00000000-0000-0000-0000-0000000071e1', 'eve@other-repeats.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071a1';
select public.create_workspace('Repeats') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'repeats.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071e1';
select public.create_workspace('Other repeats') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071a1';
select public.create_task_project(:'ws', 'Routine', 'ROU', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
select id as done from public.task_statuses where project_id = :'project' and category = 'done' \gset
select public.create_task(:'project', jsonb_build_object('title', 'Weekly report', 'assignee_id', '00000000-0000-0000-0000-0000000071b1',
  'start_date', current_date, 'due_date', current_date + 2, 'labels', jsonb_build_array('routine'))) ->> 'id' as task \gset
select 'a bad rule: ' || (public.set_task_recurrence(:'task', '{"every": 0, "unit": "week"}') ->> 'error')
  || ', an unknown unit: ' || (public.set_task_recurrence(:'task', '{"every": 2, "unit": "hour"}') ->> 'error')
  || ', ends before it starts: ' || (public.set_task_recurrence(:'task', jsonb_build_object('every', 1, 'unit', 'day', 'start', current_date + 5, 'until', current_date + 1)) ->> 'error');
select 'every 2 weeks from today: ' || ((public.set_task_recurrence(:'task', jsonb_build_object('every', 2, 'unit', 'week', 'start', current_date)) ->> 'next_on')::date - current_date) || ' days from now';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071b1';
select 'bob (a viewer) sees the rule: ' || count(*) || ', changes it: ' || (public.set_task_recurrence(:'task', '{"every": 1, "unit": "day"}') ->> 'error')
  || ', runs the rules: ' from public.task_recurrences;
select public.run_task_recurrences();
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071e1';
select 'a stranger sees rules: ' || count(*) || ', sets one: ' || (public.set_task_recurrence(:'task', '{"every": 1, "unit": "day"}') ->> 'error') from public.task_recurrences;
reset role;
-- The day has come: the server makes the copy.
select 'made: ' || (public.run_task_recurrences() ->> 'made') || ', again the same day: ' || (public.run_task_recurrences() ->> 'made');
select 'tasks: ' || string_agg(number || ' ' || title || ' for ' || coalesce(right(assignee_id::text, 4), '-') || ' start +' || (start_date - current_date) || ' due +' || (due_date - current_date)
  || ' ' || array_to_string(labels, ','), '; ' order by number) from public.tasks where project_id = :'project';
select 'next in ' || (next_on - current_date) || ' days, the assignee was told: ' || (select count(*) from public.notifications n where n.user_id = '00000000-0000-0000-0000-0000000071b1' and n.task_id = r.last_task_id)
  from public.task_recurrences r where r.task_id = :'task';
-- The copy is done early: the next one comes at once.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071a1';
select public.move_task_on_board((select last_task_id from public.task_recurrences where task_id = :'task'), :'done') ->> 'ok' as ignored \gset
reset role;
select 'after the copy is done: ' || count(*) || ' tasks, the newest starts in ' || (max(start_date) - current_date) || ' days' from public.tasks where project_id = :'project';
-- A rule with an end stops by itself; stopping by hand keeps the copies.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071a1';
select public.create_task(:'project', '{"title": "Three days only"}') ->> 'id' as short \gset
select public.set_task_recurrence(:'short', jsonb_build_object('every', 1, 'unit', 'day', 'start', current_date, 'until', current_date)) ->> 'ok' as ignored \gset
reset role;
select 'the short rule makes: ' || (public.run_task_recurrences() ->> 'made');
select 'rules left: ' || count(*) from public.task_recurrences;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000071a1';
select 'stopped: ' || (public.set_task_recurrence(:'task', null) ->> 'ok');
select 'rules: ' || (select count(*) from public.task_recurrences) || ', tasks kept: ' || (select count(*) from public.tasks where project_id = :'project');
reset role;
