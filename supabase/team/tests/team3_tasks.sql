-- Tasks in a team database: the same rules as centrally, with members and
-- groups from the sync.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set carol '00000000-0000-0000-0000-0000000000c1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test"}'''

set role service_role;
select 'sync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'))
)) ->> 'ok');
reset role;

set role authenticated;
:as_bob;
select 'bob makes a project: ' || (public.create_task_project(:'ws', 'Team tasks', 'TT', null, null) ->> 'error');
reset role;
set role authenticated;
:as_alice;
select public.create_task_project(:'ws', 'Team tasks', 'TT', null, null) ->> 'id' as project \gset
reset role;
set role authenticated;
:as_bob;
select 'bob''s task: ' || (public.create_task(:'project', '{"title": "In the team database"}') ->> 'key');
select 'team: bob assigns alice: ' || (public.create_task(:'project', jsonb_build_object('title', 'For alice', 'assignee_id', :'alice')) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'team: alice is told: ' || (public.my_notifications(:'ws', 5) ->> 'unread') || ' ' || (public.my_notifications(:'ws', 5) -> 'items' -> 0 ->> 'kind');
select public.create_task(:'project', '{"title": "Alice only", "private": true}') ->> 'id' as private_task \gset
reset role;
set role authenticated;
:as_bob;
select 'team: bob doesn''t see alice''s private task: ' || count(*) from public.tasks where id = :'private_task';
reset role;
set role authenticated;
:as_alice;
select 'team: alice publishes it: ' || (public.set_task_private(:'private_task', false) ->> 'ok');
reset role;
set role authenticated;
:as_bob;
select 'team: now bob sees it: ' || count(*) from public.tasks where id = :'private_task';
reset role;
set role authenticated;
:as_alice;
select 'team: alice adds a team board: ' || (public.save_task_board(:'project', null, 'Second team', null, null) ->> 'ok');
select 'team: analytics for the owner: ' || (public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day') ->> 'admin');
select 'team: tasks stand on the main board: ' || ((select count(*) from public.task_placements where board_id is null) > 0);
reset role;
set role authenticated;
:as_bob;
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees: ' || count(*) from public.tasks;
reset role;

-- Bob leaves (the next sync without him): his access goes.
set role service_role;
select 'sync without bob: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'))
)) ->> 'ok');
reset role;
set role authenticated;
:as_bob;
select 'bob after: ' || count(*) || ' tasks, makes one: ' || (public.create_task(:'project', '{"title": "x"}') ->> 'error') from public.tasks;
reset role;

-- Links and bulk edit (step Z3) in the team database.
set role authenticated;
:as_alice;
select public.create_task(:'project', '{"title": "Linked one"}') ->> 'id' as l1 \gset
select public.create_task(:'project', '{"title": "Linked two"}') ->> 'id' as l2 \gset
select 'team link: ' || (public.add_task_link(:'l1', :'l2', 'blocks') ->> 'ok');
select 'team loop: ' || (public.update_task(:'l1', jsonb_build_object('parent_id', :'l1')) ->> 'error');
select 'team bulk: ' || (public.bulk_update_tasks(array[:'l1', :'l2']::uuid[], '{"priority": "highest"}') ->> 'changed');
reset role;
set role authenticated;
:as_carol;
select 'carol sees links: ' || count(*) || ', links: ' || (public.add_task_link(:'l2', :'l1', 'relates') ->> 'error') from public.task_links;
reset role;

-- Task files in the team database.
set role authenticated;
:as_alice;
select 'team file: ' || (public.register_task_file(:'l1', 'plan.pdf', 'application/pdf', 100) ->> 'target');
select 'team files to the team storage: ' || (public.update_task_project(:'project', '{"files_target": "edgeknow"}') ->> 'ok');
select 'team: count the last column: ' || (public.update_task_project(:'project', '{"time_last_column": true}') ->> 'ok');
reset role;
set role authenticated;
:as_carol;
select 'carol sees files: ' || count(*) || ', attaches: ' || (public.register_task_file(:'l1', 'x.txt', 'text/plain', 5) ->> 'error') from public.task_files;
reset role;

-- A task chip on a page of the team database.
set role authenticated;
:as_alice;
select public.create_page(:'ws', null, 'Team plan') ->> 'id' as team_page \gset
reset role;
update public.pages set content = jsonb_build_array(jsonb_build_object('type', 'taskChip', 'props', jsonb_build_object('taskId', :'l1'))) where id = :'team_page';
set role authenticated;
:as_alice;
select 'team mention: ' || count(*) from public.task_page_links where task_id = :'l1';
reset role;
set role authenticated;
:as_carol;
select 'carol sees team mentions: ' || count(*) from public.task_page_links;
reset role;

-- Node space objects in the team database.
set role authenticated;
:as_alice;
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Team map', '{"nodes": [{"id": "r", "text": "Team"}]}') ->> 'id' as team_map \gset
select 'team map saved: ' || (public.save_service_object(:'team_map', 'Team map 2', null, 1) ->> 'version');
reset role;
set role authenticated;
:as_carol;
select 'carol sees team maps: ' || count(*) || ', saves: ' || (public.save_service_object(:'team_map', 'x', null, 2) ->> 'error') from public.service_objects;
reset role;
