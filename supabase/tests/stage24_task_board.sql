-- The board: only project owners manage columns and the card; removing a
-- column moves its tasks; the last column stays.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000024a1', 'alice@board.test', now()),
 ('00000000-0000-0000-0000-0000000024b1', 'bob@board.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000024a1';
select public.create_workspace('Board') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'board.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Board', 'BRD', null, null) ->> 'id' as project \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000024b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' \gset

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000024b1';
select 'bob adds a column: ' || public.save_task_status(:'project', null, 'Review', 'doing', 3, null)::text;
select 'bob changes the card: ' || public.update_task_project(:'project', '{"card_fields": ["key"]}')::text;
select public.create_task(:'project', jsonb_build_object('title', 'In review', 'status_id', :'doing')) ->> 'id' as task \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000024a1';
select public.save_task_status(:'project', null, 'Review', 'doing', 3, 2.5) ->> 'id' as review \gset
select 'columns: ' || string_agg(name || '/' || category || coalesce('/' || wip_limit, ''), ', ' order by position) from public.task_statuses where project_id = :'project';
select 'rename and limit: ' || (public.save_task_status(:'project', :'review', 'Code review', 'doing', 2, null) ->> 'ok');
select 'bad group: ' || public.save_task_status(:'project', null, 'X', 'later', null, null)::text;
select 'card fields: ' || public.update_task_project(:'project', '{"card_fields": ["key", "assignee", "due"]}')::text;
select 'unknown card field: ' || public.update_task_project(:'project', '{"card_fields": ["salary"]}')::text;
select 'remove a column with tasks, nowhere to go: ' || public.delete_task_status(:'doing', null)::text;
select 'remove it, tasks to review: ' || public.delete_task_status(:'doing', :'review')::text;
reset role;
select 'task now in: ' || s.name from public.tasks t join public.task_statuses s on s.id = t.status_id where t.id = :'task';
select 'card: ' || array_to_string(card_fields, ',') from public.task_projects where id = :'project';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000024a1';
select 'the others removed: ' || count(*) filter (where (public.delete_task_status(id, :'review') ->> 'ok')::boolean) from public.task_statuses where project_id = :'project' and id <> :'review';
select 'the last column: ' || public.delete_task_status(:'review', null)::text;
reset role;
