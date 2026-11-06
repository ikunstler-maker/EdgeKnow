-- Private tasks: only the author, assignee and participants see them (and their
-- comments, files, history); admins see only the key and the people, unless the
-- workspace lets them see contents; the author publishes them.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000038a1', 'alice@private.test', now()),
 ('00000000-0000-0000-0000-0000000038b1', 'bob@private.test', now()),
 ('00000000-0000-0000-0000-0000000038c1', 'carol@private.test', now()),
 ('00000000-0000-0000-0000-0000000038d1', 'dan@private.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038a1';
select public.create_workspace('Private') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'private.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Private', 'PRV', null, null) ->> 'id' as project \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- Bob makes a private task; alice (the workspace owner) doesn't see it.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038b1';
select public.create_task(:'project', '{"title": "Secret plan", "private": true}') ->> 'id' as task \gset
select 'bob comments: ' || (public.add_task_comment(:'task', 'Only us', '{}') ->> 'ok');
select 'bob adds carol as co-assignee: ' || (public.set_task_participants(:'task', jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000038c1', 'role', 'co_assignee'))) ->> 'ok');
select 'bob sees: ' || count(*) from public.tasks where id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038c1';
select 'carol (co-assignee) sees it and its comment: ' || (select count(*) from public.tasks where id = :'task') || ' ' || (select count(*) from public.task_comments where task_id = :'task');
select 'carol may edit: ' || (public.update_task(:'task', '{"priority": "high"}') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038d1';
select 'dan sees: ' || (select count(*) from public.tasks where id = :'task') || ' tasks, ' || (select count(*) from public.task_comments where task_id = :'task') || ' comments';
select 'dan edits: ' || public.update_task(:'task', '{"title": "Mine"}')::text;
select 'dan comments: ' || public.add_task_comment(:'task', 'Hi', '{}')::text;
select 'dan publishes: ' || public.set_task_private(:'task', false)::text;
select 'dan, not an admin, gets no list: ' || public.private_task_people(:'project')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038a1';
select 'alice (owner) sees: ' || count(*) from public.tasks where id = :'task';
select 'alice sees only the key and the people: ' || (public.private_task_people(:'project') -> 0 ->> 'key') || ' ' || jsonb_array_length(public.private_task_people(:'project') -> 0 -> 'people') || ' people, title shown: ' || (public.private_task_people(:'project')::text like '%Secret%');
select 'alice lets admins see private tasks: ' || (public.set_private_tasks_admin(:'ws', true) ->> 'ok');
select 'alice now sees it: ' || count(*) from public.tasks where id = :'task';
select 'alice switches it off again: ' || (public.set_private_tasks_admin(:'ws', false) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038c1';
select 'carol (not the author) publishes: ' || public.set_task_private(:'task', false)::text;
select 'carol may not change the admin switch: ' || public.set_private_tasks_admin(:'ws', true)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038b1';
select 'bob publishes: ' || (public.set_task_private(:'task', false) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000038d1';
select 'dan sees it now: ' || count(*) from public.tasks where id = :'task';
reset role;

delete from public.workspaces where name = 'Private';
delete from auth.users where email like '%private.test';
