-- Rukh package 2: who may take a task out of a column and put one in (by unit), the
-- project's owner always may; a column's short name and colour; rules for a task
-- leaving a column and changing in it.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000065a1', 'owner@columns.test', now()),
 ('00000000-0000-0000-0000-0000000065b1', 'anna@columns.test', now()),
 ('00000000-0000-0000-0000-0000000065c1', 'boris@columns.test', now()),
 ('00000000-0000-0000-0000-0000000065e1', 'eve@other-columns.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065a1';
select public.create_workspace('Columns') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'columns.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065e1';
select public.create_workspace('Other columns') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

-- Team A (Anna) and team B (Boris); columns 1..5.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065a1';
select public.create_workspace_group(:'ws', 'Team A') ->> 'id' as team_a \gset
select public.create_workspace_group(:'ws', 'Team B') ->> 'id' as team_b \gset
select public.set_workspace_group_member(:'ws', :'team_a', '00000000-0000-0000-0000-0000000065b1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'team_b', '00000000-0000-0000-0000-0000000065c1', true) ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Flow', 'FLW', null, array['One', 'Three', 'Five']) ->> 'id' as project \gset
select id as c1 from public.task_statuses where project_id = :'project' and name = 'One' \gset
select id as c3 from public.task_statuses where project_id = :'project' and name = 'Three' \gset
select id as c5 from public.task_statuses where project_id = :'project' and name = 'Five' \gset
select public.save_task_status(:'project', null, 'Four', 'doing', null, 2.5) ->> 'id' as c4 \gset
-- From 3 and 4 only team A takes; from 5 only team B; into 5 only team B puts.
select 'owner sets 3: ' || (public.set_column_options(:'c3', jsonb_build_object('take_groups', jsonb_build_array(:'team_a'), 'short_name', 'Work', 'color', '#22c55e')) ->> 'ok');
select public.set_column_options(:'c4', jsonb_build_object('take_groups', jsonb_build_array(:'team_a'))) ->> 'ok' as ignored \gset
select public.set_column_options(:'c5', jsonb_build_object('take_groups', jsonb_build_array(:'team_b'), 'put_groups', jsonb_build_array(:'team_b'))) ->> 'ok' as ignored \gset
select 'kept: ' || short_name || ' ' || color || ' ' || cardinality(take_groups) from public.task_statuses where id = :'c3';
select 'bad colour: ' || (public.set_column_options(:'c3', '{"color": "red"}') ->> 'error');
select 'long short name: ' || (public.set_column_options(:'c3', '{"short_name": "Thirteen chars"}') ->> 'error');
select 'a unit of another workspace: ' || (public.set_column_options(:'c3', jsonb_build_object('put_groups', jsonb_build_array(gen_random_uuid()))) ->> 'error');
select public.create_task(:'project', '{"title": "Travels"}') ->> 'id' as task \gset
-- Rules: tell Boris when a task leaves 3, and when it changes while in 4.
select 'leave rule: ' || (public.save_task_rule(:'project', jsonb_build_object('event', 'leave_status', 'status_id', :'c3', 'users', jsonb_build_array('00000000-0000-0000-0000-0000000065c1'))) ->> 'ok');
select 'change rule: ' || (public.save_task_rule(:'project', jsonb_build_object('event', 'change_in_status', 'status_id', :'c4', 'users', jsonb_build_array('00000000-0000-0000-0000-0000000065c1'))) ->> 'ok');
select 'a leave rule needs its column: ' || (public.save_task_rule(:'project', jsonb_build_object('event', 'leave_status', 'roles', jsonb_build_array('assignee'))) ->> 'error');

-- Anna (team A) brings the task to 3; Boris (team B) can't take it from there.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065b1';
select 'anna sets a column: ' || (public.set_column_options(:'c3', '{"short_name": "Mine"}') ->> 'error');
select 'anna 1 -> 3: ' || (public.move_task_on_board(:'task', :'c3') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065c1';
select 'boris 3 -> 4: ' || coalesce(public.move_task_on_board(:'task', :'c4')::text, 'null');
select 'boris 3 -> 4 by editing the task: ' || coalesce(public.update_task(:'task', jsonb_build_object('status_id', :'c4'))::text, 'null');
select 'boris may: ' || (m -> :'c3' ->> 'take') || ' take from 3, ' || (m -> :'c5' ->> 'put') || ' put into 5' from (select public.column_moves(:'project') as m) q;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065b1';
select 'anna 3 -> 5 (only B puts there): ' || coalesce(public.move_task_on_board(:'task', :'c5')::text, 'null');
select 'anna 3 -> 4: ' || (public.move_task_on_board(:'task', :'c4') ->> 'ok');
reset role;
select 'boris told it left 3: ' || count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000065c1' and task_id = :'task';
delete from public.notifications where task_id = :'task';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065c1';
select 'boris 4 -> 5 (A takes from 4): ' || coalesce(public.move_task_on_board(:'task', :'c5')::text, 'null');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065b1';
select 'anna renames it in 4: ' || (public.update_task(:'task', '{"title": "Travels far"}') ->> 'ok');
reset role;
select 'boris told it changed in 4: ' || count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000065c1' and task_id = :'task';
select 'where it stands: ' || s.name from public.tasks t join public.task_statuses s on s.id = t.status_id where t.id = :'task';
set role authenticated;
-- The owner of the project moves anything anywhere.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065a1';
select 'owner 4 -> 5: ' || (public.move_task_on_board(:'task', :'c5') ->> 'ok');
select 'owner 5 -> 1: ' || (public.move_task_on_board(:'task', :'c1') ->> 'ok');
-- A new task straight into a column only B may put into.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065b1';
select 'anna makes a task in 5: ' || coalesce(public.create_task(:'project', jsonb_build_object('title', 'Shortcut', 'status_id', :'c5'))::text, 'null');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000065e1';
select 'outsider sets a column: ' || (public.set_column_options(:'c3', '{"short_name": "X"}') ->> 'error');
select 'outsider reads moves: ' || public.column_moves(:'project')::text;
reset role;
delete from public.workspaces where id in (:'ws', :'other');
delete from auth.users where email like '%columns.test';
