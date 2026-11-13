-- Tasks from before RUKH-2: one moved to done on the board (no date), one moved back out
-- of done (a stale date), one finished in the task window (a correct date).
insert into auth.users (id, email, email_confirmed_at) values
 ('10000000-0000-0000-0000-0000000089a1', 'owner@upgrade-done.test', now());
update public.platform_settings set open_registration = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000089a1';
select public.create_workspace('Upgrade done') ->> 'id' as ws \gset
select public.create_task_project(:'ws', 'Old', 'UPD', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Board done"}') ->> 'id' as ignored \gset
select public.create_task(:'project', '{"title": "Reopened"}') ->> 'id' as ignored \gset
select public.create_task(:'project', '{"title": "Window done"}') ->> 'id' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
select id as done from public.task_statuses where project_id = :'project' and category = 'done' limit 1 \gset
update public.tasks set status_id = :'done', done_at = null, updated_at = '2026-10-01T10:00:00Z' where title = 'Board done';
update public.tasks set done_at = '2026-09-01T10:00:00Z' where title = 'Reopened';
update public.tasks set status_id = :'done', done_at = '2026-08-01T10:00:00Z' where title = 'Window done';
create table public.zz_seed_events as select count(*) as n from public.task_events;
