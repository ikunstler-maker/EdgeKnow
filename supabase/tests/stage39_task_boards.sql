-- Boards per team (the owner's example): one task on two boards, each with its own
-- column; rules between them; Board 1 freezes at «Done» and its team then sees only a
-- snapshot, until the task comes back for rework; boards open only to their groups.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000039a1', 'alice@boards.test', now()),
 ('00000000-0000-0000-0000-0000000039b1', 'bob@boards.test', now()),
 ('00000000-0000-0000-0000-0000000039c1', 'carol@boards.test', now()),
 ('00000000-0000-0000-0000-0000000039d1', 'dan@boards.test', now()),
 ('00000000-0000-0000-0000-0000000039e1', 'eve@boards.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039a1';
select public.create_workspace('Boards') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'boards.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Boards', 'BDS', null, null) ->> 'id' as project \gset
\set users '{bob,carol,dan,eve}'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039a1';
select public.create_workspace_group(:'ws', 'Team 1') ->> 'id' as t1 \gset
select public.create_workspace_group(:'ws', 'Team 2') ->> 'id' as t2 \gset
select public.set_workspace_group_member(:'ws', :'t1', '00000000-0000-0000-0000-0000000039b1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t2', '00000000-0000-0000-0000-0000000039c1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t1', '00000000-0000-0000-0000-0000000039d1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'t2', '00000000-0000-0000-0000-0000000039d1', true) ->> 'ok' as ignored \gset
select public.save_task_board(:'project', null, 'Board 1', :'t1', null) ->> 'id' as b1 \gset
select public.save_task_board(:'project', null, 'Board 2', :'t2', null) ->> 'id' as b2 \gset
select public.save_task_status(:'project', null, 'Work', 'doing', null, null) ->> 'id' as work \gset
select public.save_task_status(:'project', null, 'Internal Review', 'review', null, null) ->> 'id' as internal \gset
select public.save_task_status(:'project', null, 'External Review', 'review', null, null) ->> 'id' as external \gset
select public.save_task_status(:'project', null, 'Done 1', 'done', null, null) ->> 'id' as done1 \gset
select public.save_task_status(:'project', null, 'Backlog', 'todo', null, null) ->> 'id' as backlog \gset
select public.save_task_status(:'project', null, 'To Do', 'todo', null, null) ->> 'id' as todo2 \gset
select public.save_task_status(:'project', null, 'In Progress', 'doing', null, null) ->> 'id' as progress2 \gset
select public.save_task_status(:'project', null, 'Shipped', 'done', null, null) ->> 'id' as shipped2 \gset
select 'columns on boards: ' || string_agg(x, ',') from (
  select public.set_task_status_board(:'work', :'b1', false) ->> 'ok' x union all
  select public.set_task_status_board(:'internal', :'b1', false) ->> 'ok' union all
  select public.set_task_status_board(:'external', :'b1', false) ->> 'ok' union all
  select public.set_task_status_board(:'done1', :'b1', true) ->> 'ok' union all
  select public.set_task_status_board(:'backlog', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'todo2', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'progress2', :'b2', false) ->> 'ok' union all
  select public.set_task_status_board(:'shipped2', :'b2', false) ->> 'ok') s;
select 'rules: ' || string_agg(x, ',') from (
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'internal', 'move_to_status', :'backlog')) ->> 'ok' x union all
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'external', 'move_to_status', :'todo2')) ->> 'ok' union all
  select public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'progress2', 'move_to_status', :'done1')) ->> 'ok') s;
reset role;
update public.platform_settings set open_registration = false;
create temporary table places as select 1;
create function pg_temp.places(target uuid) returns text language sql as $$
  select string_agg(coalesce(b.name, 'main') || ':' || s.name || case when p.frozen_at is not null then ' (frozen)' else '' end, ', ' order by b.name)
  from public.task_placements p join public.task_statuses s on s.id = p.status_id left join public.task_boards b on b.id = p.board_id where p.task_id = target $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039b1';
select public.create_task(:'project', jsonb_build_object('title', 'Feature', 'status_id', :'work')) ->> 'id' as task \gset
select '1. Internal Review: ' || (public.move_task_on_board(:'task', :'internal') ->> 'ok');
reset role;
select '   places: ' || pg_temp.places(:'task');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039b1';
select '2. External Review: ' || (public.move_task_on_board(:'task', :'external') ->> 'ok');
reset role;
select '   places: ' || pg_temp.places(:'task');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039c1';
select 'carol (team 2) sees the task: ' || count(*) from public.tasks where id = :'task';
select '3. carol takes it In Progress: ' || (public.move_task_on_board(:'task', :'progress2') ->> 'ok');
reset role;
select '   places: ' || pg_temp.places(:'task');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039c1';
select 'carol comments after the freeze: ' || (public.add_task_comment(:'task', 'Internal detail of team 2', '{}') ->> 'ok');
select '4. carol ships it: ' || (public.move_task_on_board(:'task', :'shipped2') ->> 'ok');
reset role;
select '   places: ' || pg_temp.places(:'task');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039b1';
select 'bob (team 1) sees: ' || (select count(*) from public.tasks where id = :'task') || ' live, snapshot title ' ||
       (select p.snapshot ->> 'title' from public.task_placements p where p.task_id = :'task' and p.frozen_at is not null) ||
       ', team 2 comments ' || (select count(*) from public.task_comments where task_id = :'task') ||
       ', boards ' || (select string_agg(name, ',' order by name) from public.task_boards where project_id = :'project');
select 'bob moves the frozen task: ' || public.move_task_on_board(:'task', :'internal')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039d1';
select 'dan (both teams) sees it live with the comment: ' || (select count(*) from public.tasks where id = :'task') || ' ' || (select count(*) from public.task_comments where task_id = :'task');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039e1';
select 'eve (no team) sees: ' || (select count(*) from public.tasks where id = :'task') || ' tasks, ' || (select count(*) from public.task_boards where project_id = :'project') || ' boards';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039a1';
select '5. the owner sends it back for rework: ' || (public.move_task_on_board(:'task', :'internal') ->> 'ok');
reset role;
select '   places: ' || pg_temp.places(:'task');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039b1';
select 'bob sees it again with team 2''s comment: ' || (select count(*) from public.tasks where id = :'task') || ' ' || (select count(*) from public.task_comments where task_id = :'task');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000039a1';
select 'members may move frozen tasks now: ' || (public.set_frozen_moves_admin(:'project', false) ->> 'ok');
reset role;

delete from public.workspaces where name = 'Boards';
delete from auth.users where email like '%boards.test';
