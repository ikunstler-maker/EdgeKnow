-- Rukh package 3 (part 1) in a team database: the tracker's people are seats the server
-- brings; the project's owner seats them on members and the tasks follow; a restricted
-- task comes over private.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test"}'''

set role authenticated;
:as_alice;
select public.create_task_project(:'ws', 'Seats', 'SEA', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select 'a person brings people: ' || coalesce(public.import_people(:'project', '[]')::text, 'null');
reset role;
set role service_role;
select 'the server brings people: ' || public.import_people(:'project', jsonb_build_array(
  jsonb_build_object('external_id', 'u1', 'name', 'Known One', 'user_id', '00000000-0000-0000-0000-0000000000a1', 'project_role', 'editor'),
  jsonb_build_object('external_id', 'u2', 'name', 'Gone Away', 'roles', jsonb_build_array('Developers'), 'project_role', 'editor')))::text;
select 'the server imports: ' || public.import_tasks(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'SEA-1', 'number', 1, 'title', 'Open', 'status_id', :'todo', 'assignee_ext', 'u2', 'imported_assignee', 'Gone Away', 'reporter_ext', 'u1'),
  jsonb_build_object('external_key', 'SEA-2', 'number', 2, 'title', 'Restricted', 'status_id', :'todo', 'assignee_ext', 'u2', 'imported_assignee', 'Gone Away', 'private', true)))::text;
reset role;
select id as gone from public.task_import_people where project_id = :'project' and external_id = 'u2' \gset
set role authenticated;
:as_bob;
select 'bob sees tasks: ' || (select count(*) from public.tasks where project_id = :'project') || ', seats: ' || (select count(*) from public.task_import_people where project_id = :'project');
select 'bob seats himself: ' || (public.seat_import_person(:'gone', '00000000-0000-0000-0000-0000000000b1') ->> 'error');
reset role;
set role authenticated;
:as_alice;
select 'alice seats bob: ' || public.seat_import_person(:'gone', '00000000-0000-0000-0000-0000000000b1')::text;
select 'alice lists: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'assigned') || '/' || (p ->> 'reported'), '; ') from jsonb_array_elements(public.list_import_people(:'project')) p;
reset role;
set role authenticated;
:as_bob;
select 'bob sees tasks: ' || count(*) || ', his: ' || count(*) filter (where assignee_id = '00000000-0000-0000-0000-0000000000b1') from public.tasks where project_id = :'project';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7'; set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"gone@team.test"}';
select 'someone removed from the workspace sees seats: ' || (select count(*) from public.task_import_people) || ', seats a person: ' || (public.seat_import_person(:'gone', '00000000-0000-0000-0000-0000000000d7') ->> 'error');
reset role;
-- 3б: comments and moves come with the server only; a seat's comments follow it.
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' \gset
set role service_role;
select 'the server brings activity: ' || public.import_task_activity(:'project', jsonb_build_array(jsonb_build_object('external_key', 'SEA-1',
  'comments', jsonb_build_array(jsonb_build_object('external_id', 'c1', 'author_ext', 'u2', 'body', 'From before', 'created_at', '2024-01-02T10:00:00Z')),
  'moves', jsonb_build_array(jsonb_build_object('external_id', 'h1', 'actor_ext', 'u2', 'from_status', :'todo', 'to_status', :'doing', 'at', '2024-01-03T10:00:00Z')))))::text;
reset role;
set role authenticated;
:as_bob;
select 'bob brings activity: ' || coalesce(public.import_task_activity(:'project', '[]')::text, 'null');
select 'bob reads the comment: ' || string_agg(c.body || ' ' || to_char(c.created_at at time zone 'utc', 'YYYY') || ' his: ' || (c.author_id = '00000000-0000-0000-0000-0000000000b1')::text, '; ') from public.task_comments c where c.external_id = 'c1';
reset role;
-- 3б, files: the server records a file put on the Drive and notes what could not come.
set role service_role;
select 'the server notes a gap: ' || (public.note_import_gap(:'project', jsonb_build_object('external_key', 'SEA-1', 'external_id', 'f1', 'name', 'plan.fig', 'bytes', 5000000, 'reason', 'drive_error')) ->> 'ok')
  || ', records the file: ' || (public.import_task_file(:'project', jsonb_build_object('external_key', 'SEA-1', 'external_id', 'f1', 'name', 'plan.fig', 'mime_type', 'application/x-figma',
     'bytes', 5000000, 'drive_account_id', gen_random_uuid(), 'drive_file_id', 'drive-9', 'author_ext', 'u2', 'created_at', '2024-02-02T10:00:00Z')) ->> 'ok');
select public.note_import_gap(:'project', jsonb_build_object('external_key', 'SEA-2', 'external_id', 'f2', 'name', 'huge.iso', 'bytes', 900000000000, 'reason', 'too_big')) ->> 'ok' as ignored \gset
reset role;
set role authenticated;
:as_bob;
select 'bob records a file: ' || coalesce(public.import_task_file(:'project', '{}')::text, 'null');
select 'bob sees the file: ' || string_agg(name || ' ' || bytes || ' his: ' || (uploaded_by = '00000000-0000-0000-0000-0000000000b1')::text, '; ') || ', gaps: ' || (select count(*) from public.task_import_gaps) from public.task_files where external_id is not null;
reset role;
set role authenticated;
:as_alice;
select 'alice sees gaps: ' || string_agg(name || ' ' || reason, ', ') from public.task_import_gaps where resolved_at is null;
reset role;
-- 3в: a task is found by its old key only by those who may see it.
set role authenticated;
:as_alice;
select 'alice finds by the old key: ' || coalesce(public.find_task_by_key(:'ws', 'sea-1')::text, 'nothing');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7'; set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"gone@team.test"}';
select 'someone removed finds: ' || coalesce(public.find_task_by_key(:'ws', 'SEA-1')::text, 'nothing');
reset role;
-- Links kept with a task: whoever may edit it adds them; a removed member sees none.
set role authenticated;
:as_alice;
select 'alice adds a link: ' || (public.add_task_web_link((select id from public.tasks where external_key = 'SEA-1'), 'Board', 'https://example.com/board') ->> 'ok')
  || ', a bad one: ' || (public.add_task_web_link((select id from public.tasks where external_key = 'SEA-1'), 'x', 'ftp://example.com') ->> 'error');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7'; set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"gone@team.test"}';
select 'someone removed sees links: ' || count(*) from public.task_web_links;
reset role;
-- 4-1: time on tasks — the server brings the tracker's entries; a member writes their own
-- once the project tracks time; someone removed sees none.
set role service_role;
select 'the server brings time: ' || (public.import_task_time(:'project', jsonb_build_array(jsonb_build_object('external_key', 'SEA-1', 'entries', jsonb_build_array(
  jsonb_build_object('external_id', 'w1', 'author_ext', 'u2', 'minutes', 120, 'spent_on', '2024-02-02'))))) ->> 'entries');
reset role;
set role authenticated;
:as_alice;
select 'alice writes time: ' || ((public.save_task_time((select id from public.tasks where external_key = 'SEA-1'), null, 30, current_date, 'Check') ->> 'id') is not null)::text
  || ', sees minutes: ' || (select sum(minutes) from public.task_time_entries);
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7'; set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d7","email":"gone@team.test"}';
select 'someone removed sees time: ' || count(*) || ', writes: ' || (public.save_task_time((select id from public.task_time_entries limit 1), null, 5, current_date, null) ->> 'error') from public.task_time_entries;
reset role;
