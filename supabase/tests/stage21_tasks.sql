-- Tasks: only workspace admins make projects, keys count up without gaps, roles
-- come from the workspace, people and groups, every change is in the history,
-- and nothing of a project shows outside its workspace.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000021a1', 'alice@tasks.test', now()),
 ('00000000-0000-0000-0000-0000000021b1', 'bob@tasks.test', now()),
 ('00000000-0000-0000-0000-0000000021c1', 'carol@tasks.test', now()),
 ('00000000-0000-0000-0000-0000000021d1', 'dave@other-tasks.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select public.create_workspace('Tasks') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'tasks.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021d1';
select public.create_workspace('Other tasks') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
-- Projects: admins only, a valid and free key.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'bob makes a project: ' || public.create_task_project(:'ws', 'Bob', 'BOB', null, null)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select public.create_task_project(:'ws', 'Marketing', 'mkt', '📣', array['Зробити', 'В роботі', 'Готово']) as created \gset
select 'project: ' || (:'created'::jsonb ->> 'key');
select (:'created'::jsonb ->> 'id') as project \gset
select 'same key again: ' || public.create_task_project(:'ws', 'Again', 'MKT', null, null)::text;
select 'bad key: ' || public.create_task_project(:'ws', 'Bad', 'm', null, null)::text;
select 'columns: ' || string_agg(name || '/' || category, ', ' order by position) from public.task_statuses where project_id = :'project';
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' \gset
select id as done from public.task_statuses where project_id = :'project' and category = 'done' \gset

-- Everyone in the workspace edits by default: tasks get MKT-1, MKT-2.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select public.create_task(:'project', '{"title": "Draw the logo", "priority": "high", "labels": ["design"]}') as t1 \gset
select 'bob''s task: ' || (:'t1'::jsonb ->> 'key');
select (:'t1'::jsonb ->> 'id') as task \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021c1';
select 'carol''s task: ' || (public.create_task(:'project', '{"title": "Write the brief"}') ->> 'key');
select 'empty title: ' || public.create_task(:'project', '{"title": "  "}')::text;
-- Changes and their history.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'move and assign: ' || public.update_task(:'task', jsonb_build_object('status_id', :'doing', 'assignee_id', '00000000-0000-0000-0000-0000000021c1', 'due_date', '2026-12-01'))::text;
select 'assign someone from elsewhere: ' || public.update_task(:'task', '{"assignee_id": "00000000-0000-0000-0000-0000000021d1"}')::text;
select 'a column of another project: ' || public.update_task(:'task', jsonb_build_object('status_id', gen_random_uuid()))::text;
select 'its own parent: ' || public.update_task(:'task', jsonb_build_object('parent_id', :'task'))::text;
select 'done: ' || public.update_task(:'task', jsonb_build_object('status_id', :'done'))::text;
reset role;
select 'done at set: ' || (done_at is not null) from public.tasks where id = :'task';
select 'history: ' || string_agg(field, ', ' order by created_at, field) from public.task_events where task_id = :'task';
set role authenticated;

-- Dave is in another workspace: nothing shows.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021d1';
select 'dave sees: ' || (select count(*) from public.task_projects where workspace_id = :'ws') || ' projects, '
  || (select count(*) from public.tasks where workspace_id = :'ws') || ' tasks, '
  || (select count(*) from public.task_events where workspace_id = :'ws') || ' events';
select 'dave makes a task: ' || public.create_task(:'project', '{"title": "x"}')::text;

-- The workspace only views: no more edits, no comments; commenter: comments.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'viewer edits: ' || public.update_task(:'task', '{"title": "x"}')::text;
select 'viewer comments: ' || public.add_task_comment(:'task', 'Looks good', '{}')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select public.update_task_project(:'project', '{"workspace_role": "commenter"}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select public.add_task_comment(:'task', 'Looks good @carol', array['00000000-0000-0000-0000-0000000021c1', '00000000-0000-0000-0000-0000000021d1']::uuid[]) ->> 'id' as comment \gset
reset role;
select 'mentions kept: ' || array_to_string(mentions, ',') from public.task_comments where id = :'comment';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021c1';
select 'carol edits bob''s comment: ' || public.edit_task_comment(:'comment', 'mine', false)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'bob edits his own: ' || public.edit_task_comment(:'comment', 'Looks great', false)::text;
-- A personal role on top of the workspace's.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select 'bob made editor: ' || public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000021b1', 'editor')::text;
select 'dave given a role: ' || public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000021d1', 'editor')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'bob edits again: ' || public.update_task(:'task', '{"title": "Draw the new logo"}')::text;
select 'bob manages access: ' || public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000021c1', 'owner')::text;
-- Closed to the workspace: only people and groups with access.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.create_workspace_group(:'ws', 'Writers') ->> 'id' as grp \gset
select public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000021c1', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021c1';
select 'carol, closed project: ' || coalesce(public.task_project_role(:'project'), 'none') || ', tasks seen: ' || (select count(*) from public.tasks where project_id = :'project');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select 'writers may view: ' || public.set_task_project_group_role(:'project', :'grp', 'viewer')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021c1';
select 'carol through the group: ' || coalesce(public.task_project_role(:'project'), 'none') || ', tasks seen: ' || (select count(*) from public.tasks where project_id = :'project');
-- Deleting is undone the same way.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021b1';
select 'delete: ' || public.delete_task(:'task', false)::text;
select 'edit a deleted task: ' || public.update_task(:'task', '{"title": "x"}')::text;
select 'restore: ' || public.delete_task(:'task', true)::text;
-- Out of the workspace: out of the project too.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
select 'remove bob: ' || (public.remove_member(:'ws', '00000000-0000-0000-0000-0000000021b1') ->> 'ok');
reset role;
select 'bob''s project access left: ' || count(*) from public.task_project_access where user_id = '00000000-0000-0000-0000-0000000021b1';
select 'people for a move: ' || (select count(*) from jsonb_array_elements(public.team_move_people(:'ws')) p where p ->> 'email' like '%@tasks.test');

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000021a1';
insert into public.tasks (workspace_id, project_id, number, title, status_id) values (:'ws', :'project', 99, 'direct', :'todo');
update public.tasks set title = 'direct' where id = :'task';
insert into public.task_events (workspace_id, task_id, field) values (:'ws', :'task', 'fake');
select public.task_project_role_of(:'project', '00000000-0000-0000-0000-0000000021a1');
set role anon;
select public.create_task(:'project', '{"title": "anon"}');
reset role;
insert into public.tasks (workspace_id, project_id, number, title, status_id)
  values (:'other', :'project', 98, 'cross', :'todo');
\set ON_ERROR_STOP 1
