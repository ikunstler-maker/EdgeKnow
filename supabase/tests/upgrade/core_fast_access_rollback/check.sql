-- After CORE-3 and its rollback: the per-row rules are back exactly, the helpers are gone.
\pset format unaligned
\pset tuples_only on
select tablename || ': ' || qual from pg_policies where schemaname = 'public' and tablename in ('pages', 'tasks', 'service_objects') and cmd = 'SELECT' order by tablename;
select 'helpers gone: ' || not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('my_workspace_ids', 'my_task_project_ids', 'task_visible_to_me', 'task_not_frozen_for_me', 'my_page_role', 'my_object_role'));
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000091a1';
select 'the owner reads the task: ' || count(*) from public.tasks where title = 'Old task';
reset role;
