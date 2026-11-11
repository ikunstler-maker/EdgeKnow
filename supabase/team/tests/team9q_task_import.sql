-- Rukh Р-3а in a team database: the server imports tasks with their numbers and dates,
-- people don't; a project's key changes by its owner only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test"}'''

set role authenticated;
:as_alice;
select public.create_task_project(:'ws', 'From the tracker', 'IMP', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select 'a person imports: ' || coalesce(public.import_tasks(:'project', '[]')::text, 'null');
reset role;
set role service_role;
select 'the server imports: ' || public.import_tasks(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'IMP-5', 'number', 5, 'title', 'Old five', 'status_id', :'todo', 'created_at', '2025-02-02T08:00:00Z', 'imported_reporter', 'Someone Gone'),
  jsonb_build_object('external_key', 'IMP-9', 'number', 9, 'title', 'Old nine', 'status_id', :'todo')))::text;
select 'relations: ' || public.import_task_relations(:'project', jsonb_build_array(jsonb_build_object('external_key', 'IMP-9', 'parent_key', 'IMP-5')))::text;
reset role;
set role authenticated;
:as_alice;
select 'alice sees: ' || string_agg(number || ' ' || title || ' ' || to_char(created_at at time zone 'utc', 'YYYY') , ', ' order by number) from public.tasks where project_id = :'project';
select 'the next task: ' || (public.create_task(:'project', '{"title": "New here"}') ->> 'key');
reset role;
set role authenticated;
:as_bob;
select 'bob changes the key: ' || (public.set_task_project_key(:'project', 'BOB') ->> 'error');
reset role;
set role authenticated;
:as_carol;
select 'carol (a workspace admin) changes the key: ' || (public.set_task_project_key(:'project', 'CAR') ->> 'key');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7'; set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"gone@team.test"}';
select 'someone removed from the workspace sees: ' || (select count(*) from public.tasks where project_id = :'project') || ', changes the key: ' || (public.set_task_project_key(:'project', 'GONE') ->> 'error');
reset role;
set role authenticated;
:as_alice;
select 'alice changes the key: ' || (public.set_task_project_key(:'project', 'imp2') ->> 'key');
reset role;
