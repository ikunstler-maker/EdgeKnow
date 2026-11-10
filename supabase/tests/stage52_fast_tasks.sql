-- Faster reads, tasks: project_tasks() must answer exactly what reading public.tasks
-- of the project answers, for every kind of person and task: team boards, a frozen
-- column, private tasks, admins allowed to see private tasks, a closed project, an outsider.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000052a1', 'alice@fasttasks.test', now()),
 ('00000000-0000-0000-0000-0000000052b1', 'bob@fasttasks.test', now()),
 ('00000000-0000-0000-0000-0000000052c1', 'carol@fasttasks.test', now()),
 ('00000000-0000-0000-0000-0000000052d1', 'dan@fasttasks.test', now()),
 ('00000000-0000-0000-0000-0000000052e1', 'eve@fasttasks.test', now()),
 ('00000000-0000-0000-0000-0000000052f1', 'zed@elsewhere-fasttasks.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select public.create_workspace('Fast tasks') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'fasttasks.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Fast tasks', 'FTS', null, null) ->> 'id' as project \gset
\set users '{bob,carol,dan,eve}'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select public.create_workspace_group(:'ws', 'Team 1') ->> 'id' as t1 \gset
select public.create_workspace_group(:'ws', 'Team 2') ->> 'id' as t2 \gset
select public.set_workspace_group_member(:'ws', :'t1', '00000000-0000-0000-0000-0000000052b1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t2', '00000000-0000-0000-0000-0000000052c1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t1', '00000000-0000-0000-0000-0000000052d1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t2', '00000000-0000-0000-0000-0000000052d1', true) ->> 'ok' as ignored \gset
select public.save_task_board(:'project', null, 'Board 1', :'t1', null) ->> 'id' as b1 \gset
select public.save_task_board(:'project', null, 'Board 2', :'t2', null) ->> 'id' as b2 \gset
select public.save_task_status(:'project', null, 'Work', 'doing', null, null) ->> 'id' as work \gset
select public.save_task_status(:'project', null, 'Internal Review', 'review', null, null) ->> 'id' as internal \gset
select public.save_task_status(:'project', null, 'External Review', 'review', null, null) ->> 'id' as external \gset
select public.save_task_status(:'project', null, 'Done 1', 'done', null, null) ->> 'id' as done1 \gset
select public.save_task_status(:'project', null, 'Backlog', 'todo', null, null) ->> 'id' as backlog \gset
select public.save_task_status(:'project', null, 'To Do', 'todo', null, null) ->> 'id' as todo2 \gset
select public.save_task_status(:'project', null, 'In Progress', 'doing', null, null) ->> 'id' as progress2 \gset
select public.save_task_status(:'project', null, 'Shipped', 'done', null, null) ->> 'id' as shipped2 \gset
select string_agg(x, ',') as ignored from (
  select public.set_task_status_board(:'work', :'b1', false) ->> 'ok' x union all
  select public.set_task_status_board(:'internal', :'b1', false) ->> 'ok' union all
  select public.set_task_status_board(:'external', :'b1', false) ->> 'ok' union all
  select public.set_task_status_board(:'done1', :'b1', true) ->> 'ok' union all
  select public.set_task_status_board(:'backlog', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'todo2', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'progress2', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'shipped2', :'b2', false) ->> 'ok') s \gset
select string_agg(x, ',') as ignored from (
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'internal', 'move_to_status', :'backlog')) ->> 'ok' x union all
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'external', 'move_to_status', :'todo2')) ->> 'ok' union all
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'progress2', 'move_to_status', :'done1')) ->> 'ok') s \gset
reset role;
\set old 'select t.id from public.tasks t where t.project_id = :''project'''
\set new 'select t.id from public.project_tasks(:''project'') t'
\set compare 'select (select count(*) from (:old) o) || '' tasks, '' || (select count(*) from ((:old) except (:new)) d) || '' only the old way, '' || (select count(*) from ((:new) except (:old)) d) || '' only the new way'''
\set titles 'select coalesce(string_agg(title, '', '' order by number), ''none'') from public.project_tasks(:''project'')'

set role authenticated;
-- Bob (team 1): a task that travels to team 2 and freezes for team 1; a private one; a private one given to Carol.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052b1';
select public.create_task(:'project', jsonb_build_object('title', 'Travels', 'status_id', :'work')) ->> 'id' as travels \gset
select public.move_task_on_board(:'travels', :'internal') ->> 'ok' as ignored \gset
select public.move_task_on_board(:'travels', :'external') ->> 'ok' as ignored \gset
select public.create_task(:'project', jsonb_build_object('title', 'Stays with team 1', 'status_id', :'work')) ->> 'id' as stays \gset
select public.create_task(:'project', '{"title": "Bob private", "private": true}') ->> 'id' as bob_private \gset
select public.create_task(:'project', jsonb_build_object('title', 'Private for Carol', 'private', true, 'assignee_id', '00000000-0000-0000-0000-0000000052c1')) ->> 'id' as for_carol \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052c1';
select public.move_task_on_board(:'travels', :'progress2') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select public.create_task(:'project', '{"title": "On the main board"}') ->> 'id' as main_task \gset
select public.create_task(:'project', '{"title": "Trashed"}') ->> 'id' as trashed \gset
select public.delete_task(:'trashed', false) ->> 'ok' as ignored \gset

select 'alice (owner): ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052b1';
select 'bob (team 1, frozen for him): ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052c1';
select 'carol (team 2): ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052d1';
select 'dan (both teams): ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052e1';
select 'eve (no team): ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052f1';
select 'zed (not in the workspace): ' || (:compare) || ' — ' || (:titles);

-- Admins allowed to see private tasks.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select public.set_private_tasks_admin(:'ws', true) ->> 'ok' as ignored \gset
select 'alice, admins see private: ' || (:compare) || ' — ' || (:titles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052e1';
select 'eve, admins see private (she is not one): ' || (:compare);

-- The project closed to the workspace, open to team 2 only.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.set_task_project_group_role(:'project', :'t2', 'viewer') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052b1';
select 'project closed, bob (team 1): ' || (:compare);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052c1';
select 'project closed, carol (team 2): ' || (:compare);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000052a1';
select 'project closed, alice: ' || (:compare);
select 'a project that doesn''t exist: ' || (select count(*) from public.project_tasks('00000000-0000-0000-0000-000000000000'));
reset role;
select 'anon may call it: ' || has_function_privilege('anon', 'public.project_tasks(uuid)', 'execute');
