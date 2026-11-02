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
