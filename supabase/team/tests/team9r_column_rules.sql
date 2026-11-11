-- Rukh package 2 in a team database: a column only one unit may take tasks from.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''

insert into public.workspace_groups (workspace_id, name) values (:'ws', 'Gate keepers') returning id as keepers \gset
set role authenticated;
:as_alice;
select public.create_task_project(:'ws', 'Gated', 'GTD', null, array['Open', 'Held', 'Done']) ->> 'id' as project \gset
select id as open from public.task_statuses where project_id = :'project' and name = 'Open' \gset
select id as held from public.task_statuses where project_id = :'project' and name = 'Held' \gset
select id as done from public.task_statuses where project_id = :'project' and name = 'Done' \gset
select 'alice limits the column: ' || (public.set_column_options(:'held', jsonb_build_object('take_groups', jsonb_build_array(:'keepers'), 'short_name', 'Hold')) ->> 'ok');
select public.create_task(:'project', '{"title": "Held back"}') ->> 'id' as task \gset
reset role;
set role authenticated;
:as_bob;
select 'bob sets a column: ' || (public.set_column_options(:'held', '{"short_name": "Bob"}') ->> 'error');
select 'bob puts it in: ' || (public.move_task_on_board(:'task', :'held') ->> 'ok');
select 'bob takes it out: ' || coalesce(public.move_task_on_board(:'task', :'done')::text, 'null');
select 'bob may take from it: ' || (public.column_moves(:'project') -> :'held' ->> 'take');
reset role;
set role authenticated;
:as_alice;
select 'the owner takes it out: ' || (public.move_task_on_board(:'task', :'done') ->> 'ok');
reset role;
