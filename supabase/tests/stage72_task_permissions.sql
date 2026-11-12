-- Rukh, access rights one to one (Д-1): a project's permissions, action by action. Without
-- any, everything is as before; a row says who may do an action — roles, units, members,
-- the task's author, its assignee; owners always may; the database enforces it.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000072a1', 'alice@rights.test', now()),
 ('00000000-0000-0000-0000-0000000072b1', 'bob@rights.test', now()),
 ('00000000-0000-0000-0000-0000000072c1', 'carl@rights.test', now()),
 ('00000000-0000-0000-0000-0000000072d1', 'dana@rights.test', now()),
 ('00000000-0000-0000-0000-0000000072e1', 'eve@other-rights.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072a1';
select public.create_workspace('Rights') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'rights.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072e1';
select public.create_workspace('Other rights') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

-- alice owns the project; bob is an editor, carl a commenter, dana a viewer.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072a1';
select public.create_task_project(:'ws', 'Ruled', 'RUL', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000072b1', 'editor') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000072c1', 'commenter') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000072d1', 'viewer') ->> 'ok' as ignored \gset
select public.create_workspace_group(:'ws', 'Movers') ->> 'id' as movers \gset
select public.set_workspace_group_member(:'ws', :'movers', '00000000-0000-0000-0000-0000000072d1', true) ->> 'ok' as ignored \gset
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select public.create_task(:'project', jsonb_build_object('title', 'Ruled task', 'assignee_id', '00000000-0000-0000-0000-0000000072c1')) ->> 'id' as task \gset

-- Without rows: as it always was.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072b1';
select 'usual — the editor edits: ' || (public.update_task(:'task', '{"title": "Ruled task, edited"}') ->> 'ok') || ', moves: ' || (public.move_task_on_board(:'task', :'doing') ->> 'ok')
  || ', makes a task: ' || ((public.create_task(:'project', '{"title": "By bob"}') ->> 'id') is not null)::text || ', sets permissions: ' || (public.set_task_permission(:'project', 'edit', '{"roles": ["viewer"]}') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072c1';
select 'usual — the commenter edits: ' || (public.update_task(:'task', '{"title": "x"}') ->> 'error') || ', moves: ' || (public.move_task_on_board(:'task', :'todo') ->> 'error')
  || ', makes a task: ' || (public.create_task(:'project', '{"title": "By carl"}') ->> 'error') || ', what he may: ' || public.my_task_permissions(:'task')::text;

-- The owner's own rules.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072a1';
select 'rules set: ' || (public.set_task_permission(:'project', 'transition', jsonb_build_object('assignee', true, 'groups', jsonb_build_array(:'movers'))) ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'edit', '{"roles": [], "reporter": true}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'create', '{"roles": ["editor", "commenter"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'assign', jsonb_build_object('members', jsonb_build_array('00000000-0000-0000-0000-0000000072d1'))) ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'be_assigned', '{"roles": ["editor"]}') ->> 'ok')
  || ', an unknown action: ' || (public.set_task_permission(:'project', 'fly', '{}') ->> 'error')
  || ', a stranger as a holder: ' || (public.set_task_permission(:'project', 'delete', jsonb_build_object('members', jsonb_build_array('00000000-0000-0000-0000-0000000072e1'))) ->> 'error')
  || ', a role that is not one: ' || (public.set_task_permission(:'project', 'delete', '{"roles": ["owner"]}') ->> 'error');
-- The editor lost editing and moving (only the author edits; only the assignee and the unit move).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072b1';
select 'the editor edits: ' || (public.update_task(:'task', '{"title": "y"}') ->> 'error') || ', moves: ' || (public.move_task_on_board(:'task', :'todo') ->> 'error')
  || ', moves through an update: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'todo')) ->> 'error')
  || ', sets a date (still his): ' || (public.update_task(:'task', jsonb_build_object('due_date', current_date + 3)) ->> 'ok')
  || ', assigns: ' || (public.update_task(:'task', '{"assignee_id": "00000000-0000-0000-0000-0000000072b1"}') ->> 'error')
  || ', many at once: ' || (public.bulk_update_tasks(array[:'task']::uuid[], '{"priority": "high"}') ->> 'error');
-- The commenter is the assignee: he moves, and may now make tasks; his own task he edits as its author.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072c1';
select 'the assignee moves: ' || (public.move_task_on_board(:'task', :'todo') ->> 'ok') || ', edits: ' || (public.update_task(:'task', '{"title": "z"}') ->> 'error');
select public.create_task(:'project', '{"title": "By carl"}') ->> 'id' as carls \gset
select 'the commenter makes a task: ' || (:'carls' is not null)::text || ', edits it as its author: ' || (public.update_task(:'carls', '{"title": "By carl, edited"}') ->> 'ok')
  || ', what he may with it: ' || public.my_task_permissions(:'carls')::text;
-- The viewer is in the unit that moves, and is named for assigning — but only editors may be assigned.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072d1';
select 'the unit''s member moves: ' || (public.move_task_on_board(:'task', :'doing') ->> 'ok')
  || ', assigns a commenter: ' || (public.update_task(:'task', '{"assignee_id": "00000000-0000-0000-0000-0000000072d1"}') ->> 'error')
  || ', assigns an editor: ' || (public.update_task(:'task', '{"assignee_id": "00000000-0000-0000-0000-0000000072b1"}') ->> 'ok')
  || ', edits: ' || (public.update_task(:'task', '{"title": "w"}') ->> 'error') || ', deletes: ' || (public.delete_task(:'task', false) ->> 'error');
-- The owner always may; a stranger never.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072a1';
select 'the owner edits and moves: ' || (public.update_task(:'task', jsonb_build_object('title', 'Owner''s word', 'status_id', :'todo')) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072e1';
select 'a stranger sees rules: ' || count(*) || ', sets one: ' || (public.set_task_permission(:'project', 'edit', '{"roles": ["viewer"]}') ->> 'error')
  || ', asks what he may: ' || coalesce(public.project_permits(:'project', 'create')::text, 'null') from public.task_permissions;
-- Back to the usual.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072a1';
select 'reset: ' || (public.set_task_permission(:'project', 'edit', null) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000072b1';
select 'the editor edits again: ' || (public.update_task(:'task', '{"title": "Back"}') ->> 'ok') || ', rules he sees: ' || (select count(*) from public.task_permissions where project_id = :'project');
insert into public.task_permissions (project_id, workspace_id, action) values (:'project', :'ws', 'edit');
reset role;
