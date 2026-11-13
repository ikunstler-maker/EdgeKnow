-- A task and a page from before CORE-3.
insert into auth.users (id, email, email_confirmed_at) values
 ('10000000-0000-0000-0000-0000000092a1', 'owner@upgrade-fast2.test', now());
update public.platform_settings set open_registration = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000092a1';
select public.create_workspace('Upgrade fast 2') ->> 'id' as ws \gset
select public.create_task_project(:'ws', 'Old', 'UPG', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Old task"}') ->> 'id' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
