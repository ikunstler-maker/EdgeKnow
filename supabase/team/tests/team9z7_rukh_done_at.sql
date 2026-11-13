-- RUKH-2 in a team database: a task's "done" date follows its column on the board too.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select id as project from public.task_projects where workspace_id = :'ws' order by created_at limit 1 \gset
select public.create_task(:'project', '{"title": "Done date"}') ->> 'id' as task \gset
reset role;
select id as done from public.task_statuses where project_id = :'project' and category = 'done' order by position limit 1 \gset
select id as open from public.task_statuses where project_id = :'project' and category <> 'done' order by position limit 1 \gset
set role authenticated;
:as_bob;
select 'board move into done: ' || coalesce(public.move_task_on_board(:'task', :'done') ->> 'ok', 'error');
select '…date set: ' || (done_at is not null) from public.tasks where id = :'task';
select 'back out: ' || coalesce(public.move_task_on_board(:'task', :'open') ->> 'ok', 'error');
select '…date cleared: ' || (done_at is null) from public.tasks where id = :'task';
reset role;
select 'anon may call the rule: ' || has_function_privilege('anon', 'public.task_done_at()', 'execute');
