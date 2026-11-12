-- Rukh package 3: a private task that came from the tracker is seen by the project's
-- owners; a private task made here keeps its rule (author, assignee, participants).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000067a1', 'alice@hidden.test', now()),
 ('00000000-0000-0000-0000-0000000067b1', 'bob@hidden.test', now()),
 ('00000000-0000-0000-0000-0000000067c1', 'carl@hidden.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067a1';
select public.create_workspace('Hidden') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'hidden.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067a1';
select public.create_task_project(:'ws', 'Hidden things', 'HID', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000067c1', 'owner') ->> 'ok' as ignored \gset
reset role;
select 'imported: ' || (public.import_tasks(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'HID-1', 'number', 1, 'title', 'Restricted there', 'status_id', :'todo', 'private', true))) ->> 'created');
-- Bob's own private task.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067b1';
select public.create_task(:'project', '{"title": "Bob only"}') ->> 'id' as own \gset
select 'bob hides his task: ' || (public.set_task_private(:'own', true) ->> 'ok');
select 'bob (an editor) sees: ' || coalesce(string_agg(title, ', ' order by number), 'nothing') from public.tasks where project_id = :'project';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067a1';
select 'alice (the workspace owner) sees: ' || coalesce(string_agg(title, ', ' order by number), 'nothing') from public.tasks where project_id = :'project';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067c1';
select 'carl (a project owner) sees: ' || coalesce(string_agg(title, ', ' order by number), 'nothing') from public.tasks where project_id = :'project';
reset role;

-- 3в: a task is found by its old key or its key here, only by those who may see it.
update public.task_projects set key = 'HIDE' where id = :'project';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067a1';
select 'alice finds the old key: ' || coalesce(public.find_task_by_key(:'ws', 'hid-1')::text, 'nothing')
  || ', the key here: ' || coalesce(public.find_task_by_key(:'ws', 'HIDE-1')::text, 'nothing')
  || ', bob''s private one: ' || coalesce(public.find_task_by_key(:'ws', 'HIDE-2')::text, 'nothing')
  || ', no such: ' || coalesce(public.find_task_by_key(:'ws', 'HID-99')::text, 'nothing');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067b1';
select 'bob finds the restricted one: ' || coalesce(public.find_task_by_key(:'ws', 'HID-1')::text, 'nothing') || ', his own: ' || coalesce(public.find_task_by_key(:'ws', 'HIDE-2')::text, 'nothing');
reset role;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000067e1', 'eve@elsewhere.test', now());
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000067e1';
select 'a stranger finds: ' || coalesce(public.find_task_by_key(:'ws', 'HID-1')::text, 'nothing');
reset role;
