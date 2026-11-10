-- A project's tasks in one pass, in a team database: the same rows as reading the table.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select id as project from public.task_projects where workspace_id = :'ws' order by created_at limit 1 \gset
select public.create_task(:'project', '{"title": "Fast task"}') ->> 'id' as task \gset
select public.create_task(:'project', '{"title": "Fast private task", "private": true}') ->> 'id' as private_task \gset
select 'bob: ' || ((select count(*) from public.tasks where project_id = :'project') > 0) || ' some tasks, '
  || (select count(*) from ((select id from public.tasks where project_id = :'project') except (select id from public.project_tasks(:'project'))) d) || ' only the old way, '
  || (select count(*) from ((select id from public.project_tasks(:'project')) except (select id from public.tasks where project_id = :'project')) d) || ' only the new way';
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || (select count(*) from public.project_tasks(:'project')) || ' the new way, ' || (select count(*) from public.tasks where project_id = :'project') || ' the old way';
reset role;
select 'anon may call it: ' || has_function_privilege('anon', 'public.project_tasks(uuid)', 'execute');
