-- CORE-3: the read rules check membership and project roles once per query. Who sees
-- what is unchanged (the other security tests give the same output); here: the helpers
-- are not for strangers, and they only ever answer about the signed-in person.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

select 'anon may call ' || p.proname || ': ' || has_function_privilege('anon', p.oid, 'execute')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('my_workspace_ids', 'my_task_project_ids', 'task_visible_to_me', 'task_not_frozen_for_me', 'my_page_role', 'my_object_role')
order by p.proname;

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000091a1', 'alice@cfa.test', now()),
 ('00000000-0000-0000-0000-0000000091e1', 'eve@other-cfa.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000091a1';
select public.create_workspace('Fast access') ->> 'id' as ws \gset
select public.create_task_project(:'ws', 'Fast', 'FAS', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Seen"}') ->> 'id' as task \gset
select 'alice: workspace ' || (:'ws' in (select public.my_workspace_ids())) || ', project ' || (:'project' in (select public.my_task_project_ids()))
  || ', owns it ' || (:'project' in (select public.my_task_project_ids(true))) || ', task ' || public.task_visible_to_me(:'task') || ', reads it ' || (select count(*) from public.tasks where id = :'task');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000091e1';
select 'eve: workspace ' || (:'ws' in (select public.my_workspace_ids())) || ', project ' || (:'project' in (select public.my_task_project_ids()))
  || ', reads the task ' || (select count(*) from public.tasks where id = :'task');
reset role;
update public.platform_settings set open_registration = false;
