-- Rukh package 3 (part 1): the tracker's people are seats. A seat is tied to a member by
-- email at once or by the project's owner later, and can be re-seated: the person's tasks
-- follow. A seated person gets the role their tracker role maps to. A restricted task
-- comes over private. Seats are written only by the server and the seating function.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000066a1', 'alice@seats.test', now()),
 ('00000000-0000-0000-0000-0000000066b1', 'bob@seats.test', now()),
 ('00000000-0000-0000-0000-0000000066c1', 'carl@seats.test', now()),
 ('00000000-0000-0000-0000-0000000066e1', 'eve@other-seats.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066a1';
select public.create_workspace('Seats') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'seats.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066e1';
select public.create_workspace('Other seats') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066a1';
select public.create_task_project(:'ws', 'Moved', 'MOV', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
-- People are not for a member to bring in.
select 'member brings people: ' || coalesce(public.import_people(:'project', '[]')::text, 'null');
reset role;
-- A closed project: only those given access see it.
update public.task_projects set workspace_role = null where id = :'project';
select 'bob before: ' || coalesce(public.task_project_role_of(:'project', '00000000-0000-0000-0000-0000000066b1'), 'no access');

-- The server brings three people: one by email, one nobody knows, one chosen in the wizard.
select 'people: ' || public.import_people(:'project', jsonb_build_array(
  jsonb_build_object('external_id', 'u1', 'name', 'Bob Tracker', 'email', 'BOB@seats.test', 'roles', jsonb_build_array('Developers'), 'project_role', 'editor'),
  jsonb_build_object('external_id', 'u2', 'name', 'Old Timer', 'roles', jsonb_build_array('Viewers'), 'project_role', 'viewer'),
  jsonb_build_object('external_id', 'u3', 'name', 'Carl Tracker', 'user_id', '00000000-0000-0000-0000-0000000066c1', 'project_role', 'commenter')))::text;
select 'bad person: ' || (public.import_people(:'project', jsonb_build_array(jsonb_build_object('external_id', 'u4', 'name', 'X', 'project_role', 'boss'))) ->> 'error');
select 'bob after: ' || coalesce(public.task_project_role_of(:'project', '00000000-0000-0000-0000-0000000066b1'), 'no access')
  || ', carl: ' || coalesce(public.task_project_role_of(:'project', '00000000-0000-0000-0000-0000000066c1'), 'no access');
select id as old_timer from public.task_import_people where project_id = :'project' and external_id = 'u2' \gset

select 'tasks: ' || public.import_tasks(:'project', jsonb_build_array(
  jsonb_build_object('external_key', 'MOV-1', 'number', 1, 'title', 'Open one', 'status_id', :'todo', 'assignee_ext', 'u2', 'reporter_ext', 'u1', 'imported_assignee', 'Old Timer', 'imported_reporter', 'Bob Tracker'),
  jsonb_build_object('external_key', 'MOV-2', 'number', 2, 'title', 'Restricted', 'status_id', :'todo', 'assignee_ext', 'u2', 'imported_assignee', 'Old Timer', 'private', true),
  jsonb_build_object('external_key', 'MOV-3', 'number', 3, 'title', 'Bob holds', 'status_id', :'todo', 'assignee_ext', 'u1', 'reporter_ext', 'u9')))::text;
select external_key || ': held by ' || coalesce(assignee_id::text, 'nobody') || ' (' || coalesce(imported_assignee, '-') || '), written by ' || coalesce(right(reporter_id::text, 4), 'nobody')
  || ' (' || coalesce(imported_reporter, '-') || '), seats ' || (assignee_slot is not null)::text || '/' || (reporter_slot is not null)::text || ', private ' || private
  from public.tasks where project_id = :'project' order by number;

-- Who sees what: the restricted task has no one yet.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066b1';
select 'bob sees tasks: ' || count(*) from public.tasks where project_id = :'project';
select 'bob sees seats: ' || count(*) from public.task_import_people where project_id = :'project';
select 'bob seats a person: ' || (public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066b1') ->> 'error');
select 'bob lists people: ' || coalesce(public.list_import_people(:'project')::text, 'null');
-- Writing a seat directly is refused.
update public.task_import_people set user_id = '00000000-0000-0000-0000-0000000066b1' where id = :'old_timer';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066e1';
select 'a stranger sees seats: ' || count(*) from public.task_import_people;
select 'a stranger seats a person: ' || (public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066e1') ->> 'error');

-- The owner seats the unknown person on carl: both tasks go to him, the private one too.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066a1';
select 'seat on a stranger: ' || (public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066e1') ->> 'error');
select 'seat on carl: ' || public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066c1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066c1';
select 'carl sees tasks: ' || count(*) || ', his: ' || count(*) filter (where assignee_id = '00000000-0000-0000-0000-0000000066c1') || ', names left: ' || count(imported_assignee) from public.tasks where project_id = :'project';
reset role;
select 'carl keeps the higher role: ' || public.task_project_role_of(:'project', '00000000-0000-0000-0000-0000000066c1');
select 'nobody was told: ' || count(*) from public.notifications where workspace_id = :'ws';

-- Re-seated on bob: the tasks follow; a task handed to someone else meanwhile stays.
update public.tasks set assignee_id = '00000000-0000-0000-0000-0000000066a1' where project_id = :'project' and number = 1;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066a1';
select 're-seat on bob: ' || public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066b1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066c1';
select 'carl sees tasks: ' || count(*) from public.tasks where project_id = :'project';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000066a1';
select 'seat freed: ' || public.seat_import_person(:'old_timer', null)::text;
select 'the name is back: ' || coalesce(imported_assignee, '-') || ', held by ' || coalesce(assignee_id::text, 'nobody') from public.tasks where project_id = :'project' and number = 2;
select 'owner lists: ' || string_agg((p ->> 'name') || ' ' || (p ->> 'assigned') || '/' || (p ->> 'reported') || ' ' || coalesce(right(p ->> 'user_id', 4), 'free'), '; ')
  from jsonb_array_elements(public.list_import_people(:'project')) p;
reset role;

-- A name an earlier import kept as text becomes the person once the tracker names them.
insert into public.task_import_people (workspace_id, project_id, name) values (:'ws', :'project', 'Legacy Name');
select 'legacy joined: ' || (public.import_people(:'project', jsonb_build_array(jsonb_build_object('external_id', 'u7', 'name', 'legacy name'))) ->> 'people')
  || ', seats: ' || (select count(*) from public.task_import_people where project_id = :'project');
-- A second run of the import leaves a taken seat with whoever sits there.
select public.seat_import_person(:'old_timer', '00000000-0000-0000-0000-0000000066c1') ->> 'ok' as ignored \gset
select 'second run: ' || (public.import_people(:'project', jsonb_build_array(jsonb_build_object('external_id', 'u2', 'name', 'Old Timer', 'user_id', '00000000-0000-0000-0000-0000000066b1'))) ->> 'seated')
  || ', still ' || right((select user_id::text from public.task_import_people where id = :'old_timer'), 4);
