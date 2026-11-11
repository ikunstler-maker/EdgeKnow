-- Rukh Р-3а: tasks from another tracker keep their numbers, dates and people; nobody is
-- notified; a second run updates instead of doubling; joining a project with tasks moves
-- its own tasks after the imported ones; a project's key changes only by its owner or an
-- admin; the import functions and the imports table are for the server only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000064a1', 'alice@imports.test', now()),
 ('00000000-0000-0000-0000-0000000064b1', 'bob@imports.test', now()),
 ('00000000-0000-0000-0000-0000000064e1', 'eve@other-imports.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064a1';
select public.create_workspace('Imports') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'imports.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064e1';
select public.create_workspace('Other imports') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064a1';
select public.create_task_project(:'ws', 'Old tracker', 'TMD', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select id as done from public.task_statuses where project_id = :'project' and category = 'done' \gset
-- Two tasks of our own before the import (numbers 1 and 2).
select public.create_task(:'project', '{"title": "Own first"}') ->> 'key' as ignored \gset
select public.create_task(:'project', '{"title": "Own second"}') ->> 'key' as ignored \gset

-- The import functions are not for people.
select 'member imports: ' || coalesce(public.import_tasks(:'project', '[]')::text, 'null');
select 'member makes room: ' || coalesce(public.make_room_for_import(:'project', 5)::text, 'null');
select 'member reads imports: ' || count(*) from public.task_imports;
reset role;

-- The server (no test role for it in this database: the owner of the tables stands in): a number of our own task is in the way until room is made.
select 'number in the way: ' || (public.import_tasks(:'project', jsonb_build_array(jsonb_build_object(
  'external_key', 'TMD-1', 'number', 1, 'title', 'Imported one', 'status_id', :'todo'))) ->> 'error');
reset role;
select 'room made: ' || (public.make_room_for_import(:'project', 7) ->> 'moved');
reset role;
select 'own tasks now: ' || string_agg(number || ' ' || title, ', ' order by number) from public.tasks where project_id = :'project';
select 'imported: ' || public.import_tasks(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'TMD-1', 'external_url', 'https://old.example/browse/TMD-1', 'number', 1, 'title', 'Imported epic', 'status_id', :'todo', 'type', 'epic',
    'priority', 'high', 'reporter_id', '00000000-0000-0000-0000-0000000064a1', 'assignee_id', '00000000-0000-0000-0000-0000000064b1',
    'labels', jsonb_build_array('old', 'q4'), 'due_date', '2026-12-01', 'estimate', 3.5, 'created_at', '2025-03-01T10:00:00Z', 'updated_at', '2025-03-05T10:00:00Z'),
  jsonb_build_object('external_key', 'TMD-7', 'number', 7, 'title', 'Imported done', 'status_id', :'done', 'imported_reporter', 'Former Colleague',
    'imported_assignee', 'Outside Person', 'created_at', '2025-04-01T10:00:00Z', 'updated_at', '2025-04-09T10:00:00Z', 'done_at', '2025-04-08T10:00:00Z')))::text;
reset role;
select 'kept: ' || string_agg(number || ' ' || title || ' ' || to_char(created_at at time zone 'utc', 'YYYY-MM-DD') || ' ' || coalesce(imported_reporter, '-') || ' ' || coalesce(to_char(done_at at time zone 'utc', 'YYYY-MM-DD'), '-'), ', ' order by number)
  from public.tasks where project_id = :'project' and external_key is not null;
select 'next number: ' || next_number from public.task_projects where id = :'project';
select 'history: ' || string_agg(e.field || ' ' || to_char(e.created_at at time zone 'utc', 'YYYY-MM-DD'), ', ' order by e.created_at)
  from public.task_events e join public.tasks t on t.id = e.task_id where t.project_id = :'project' and t.external_key is not null;
select 'nobody notified: ' || count(*) from public.notifications n join public.tasks t on t.id = n.task_id where t.external_key is not null;
select 'placed on the board: ' || count(*) from public.task_placements p join public.tasks t on t.id = p.task_id where t.external_key is not null;
-- A second run changes, never doubles.
select 'again: ' || public.import_tasks(:'project', jsonb_build_array(jsonb_build_object(
  'external_key', 'TMD-7', 'number', 7, 'title', 'Imported done, renamed', 'status_id', :'todo')))::text;
reset role;
select 'after again: ' || count(*) || ' ' || max(title) || ' ' || coalesce(max(done_at)::text, 'not done') from public.tasks where project_id = :'project' and external_key = 'TMD-7';
select 'relations: ' || public.import_task_relations(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'TMD-7', 'parent_key', 'TMD-1', 'links', jsonb_build_array(
    jsonb_build_object('kind', 'blocks', 'other_key', 'TMD-1'), jsonb_build_object('kind', 'relates', 'other_key', 'TMD-99')))))::text;
reset role;
select 'parent set: ' || (select p.external_key from public.tasks p where p.id = t.parent_id) from public.tasks t where t.external_key = 'TMD-7' and t.project_id = :'project';
select 'bad status: ' || (public.import_tasks(:'project', jsonb_build_array(jsonb_build_object('external_key', 'TMD-8', 'number', 8, 'title', 'X', 'status_id', gen_random_uuid()))) ->> 'error');
reset role;

-- People see the imported tasks by the project's rules; an outsider sees none.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064b1';
select 'member sees imported: ' || count(*) from public.tasks where project_id = :'project' and external_key is not null;
select 'member changes the key: ' || (public.set_task_project_key(:'project', 'NEW') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064e1';
select 'outsider sees: ' || count(*) from public.tasks where project_id = :'project';
select 'outsider changes the key: ' || (public.set_task_project_key(:'project', 'NEW') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000064a1';
select public.create_task_project(:'ws', 'Second', 'SEC', null, array['To do', 'Doing', 'Done']) ->> 'ok' as ignored \gset
select 'taken key: ' || (public.set_task_project_key(:'project', 'sec') ->> 'error');
select 'bad key: ' || (public.set_task_project_key(:'project', '1x') ->> 'error');
select 'owner changes the key: ' || (public.set_task_project_key(:'project', 'tmd0') ->> 'key');
select 'old key is free: ' || (public.create_task_project(:'ws', 'From the tracker', 'TMD', null, array['To do', 'Doing', 'Done']) ->> 'ok');
reset role;
select 'logged: ' || (details ->> 'from') || ' -> ' || (details ->> 'to') from public.audit_log where action = 'task_project_key_changed' and workspace_id = :'ws';

delete from public.workspaces where id in (:'ws', :'other');
delete from auth.users where email like '%imports.test';
