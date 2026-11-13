-- RUKH-2: a task's "done" date follows its column, whatever moves it: the task window,
-- the board, removing a column; a date given with the move (the import) is kept.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000090d1', 'alice@rda.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090d1';
select public.create_workspace('Done dates') ->> 'id' as ws \gset
select public.create_task_project(:'ws', 'Work', 'DDT', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
reset role;
update public.platform_settings set open_registration = false;
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' order by position limit 1 \gset
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' order by position limit 1 \gset
select id as done from public.task_statuses where project_id = :'project' and category = 'done' order by position limit 1 \gset

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090d1';
select public.create_task(:'project', '{"title": "Board move"}') ->> 'id' as task \gset
select 'new task has a date: ' || (done_at is not null) from public.tasks where id = :'task';
select 'board move into done: ' || (public.move_task_on_board(:'task', :'done') ->> 'ok');
select '…date set: ' || (done_at is not null) from public.tasks where id = :'task';
select 'back to doing: ' || (public.move_task_on_board(:'task', :'doing') ->> 'ok');
select '…date cleared: ' || (done_at is null) from public.tasks where id = :'task';
select 'task window into done: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'done')) ->> 'ok');
select '…date set: ' || (done_at is not null) from public.tasks where id = :'task';
select 'title change: ' || (public.update_task(:'task', '{"title": "Renamed"}') ->> 'ok');
select '…keeps the date: ' || (done_at is not null) from public.tasks where id = :'task';
select 'task window back to to-do: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'todo')) ->> 'ok');
select '…date cleared: ' || (done_at is null) from public.tasks where id = :'task';
select public.create_task(:'project', jsonb_build_object('title', 'Made done', 'status_id', :'done')) ->> 'id' as made_done \gset
select 'created straight in done has a date: ' || (done_at is not null) from public.tasks where id = :'made_done';
reset role;

-- Between two "done" columns the date stays; a date given with the move is kept (import).
insert into public.task_statuses (project_id, workspace_id, name, category, position) values (:'project', :'ws', 'Shipped', 'done', 99) returning id as shipped \gset
update public.tasks set done_at = '2026-01-02T03:04:05Z' where id = :'made_done';
update public.tasks set status_id = :'shipped' where id = :'made_done';
select 'done → another done keeps the date: ' || (done_at = '2026-01-02T03:04:05Z') from public.tasks where id = :'made_done';
update public.tasks set status_id = :'doing', done_at = null where id = :'task';
update public.tasks set status_id = :'done', done_at = '2025-05-05T05:05:05Z' where id = :'task';
select 'a date given with the move is kept: ' || (done_at = '2025-05-05T05:05:05Z') from public.tasks where id = :'task';
update public.tasks set status_id = :'doing', done_at = '2025-05-05T05:05:05Z' where id = :'task';
select 'out of done the date goes even if given: ' || (done_at is null) from public.tasks where id = :'task';

-- Removing a column moves its tasks: into a done column they get a date.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090d1';
select 'remove doing into done: ' || (public.delete_task_status(:'doing', :'done') ->> 'ok');
select 'moved by the removal has a date: ' || (done_at is not null) from public.tasks where id = :'task';
reset role;
