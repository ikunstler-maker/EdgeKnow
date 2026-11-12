-- Rukh 4-1: time spent on tasks. A project turns it on and says who sees the entries; a
-- person writes down and changes their own time; the owner may change anyone's; entries
-- from the tracker come with the server and follow a seat.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000069a1', 'alice@hours.test', now()),
 ('00000000-0000-0000-0000-0000000069b1', 'bob@hours.test', now()),
 ('00000000-0000-0000-0000-0000000069c1', 'carl@hours.test', now()),
 ('00000000-0000-0000-0000-0000000069e1', 'eve@other-hours.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select public.create_workspace('Hours') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'hours.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069e1';
select public.create_workspace('Other hours') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select public.create_task_project(:'ws', 'Timed', 'TIM', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select id as todo from public.task_statuses where project_id = :'project' and category = 'todo' \gset
select public.create_task(:'project', jsonb_build_object('title', 'Timed task', 'assignee_id', '00000000-0000-0000-0000-0000000069b1')) ->> 'id' as task \gset
-- Off until the project's owner turns it on.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069b1';
select 'tracking off: ' || (public.save_task_time(:'task', null, 30, current_date, null) ->> 'error')
  || ', bob turns it on: ' || (public.set_project_time_tracking(:'project', true, 'all') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select 'the owner turns it on: ' || (public.set_project_time_tracking(:'project', true, 'owners') ->> 'ok')
  || ', a bad choice: ' || (public.set_project_time_tracking(:'project', true, 'nobody') ->> 'error');
-- Bob (the assignee) and carl write down time.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069b1';
select public.save_task_time(:'task', null, 90, current_date, 'Layout') ->> 'id' as bob_entry \gset
select 'bob writes: ' || (:'bob_entry' is not null)::text
  || ', nothing: ' || (public.save_task_time(:'task', null, 0, current_date, null) ->> 'error')
  || ', next year: ' || (public.save_task_time(:'task', null, 10, current_date + 400, null) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069c1';
select public.save_task_time(:'task', null, 45, current_date, null) ->> 'id' as carl_entry \gset
select 'carl changes bob''s: ' || (public.save_task_time(:'task', :'bob_entry', 5, current_date, null) ->> 'error')
  || ', removes bob''s: ' || (public.delete_task_time(:'bob_entry') ->> 'error')
  || ', changes his own: ' || (public.save_task_time(:'task', :'carl_entry', 60, current_date, 'Review') ->> 'ok');
-- Who sees what, by the project's choice.
select 'owners only — carl sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069b1';
select 'owners only — bob (the assignee) sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select 'owners only — the owner sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
select public.set_project_time_tracking(:'project', true, 'assignee') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069b1';
select 'with the assignee — bob sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069c1';
select 'with the assignee — carl sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select public.set_project_time_tracking(:'project', true, 'all') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069c1';
select 'everyone — carl sees: ' || coalesce(sum(minutes), 0) from public.task_time_entries where task_id = :'task';
insert into public.task_time_entries (workspace_id, task_id, user_id, minutes, spent_on) values (:'ws', :'task', '00000000-0000-0000-0000-0000000069c1', 5, current_date);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069e1';
select 'a stranger sees: ' || count(*) || ', writes: ' || (public.save_task_time(:'task', null, 10, current_date, null) ->> 'error')
  || ', removes: ' || (public.delete_task_time(:'bob_entry') ->> 'error') || ', reads the report: ' || coalesce(public.project_time_report(:'project', null, null)::text, 'null')
  from public.task_time_entries;
-- The owner's report, and the owner may correct anyone's entry.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select 'the owner corrects bob''s: ' || (public.save_task_time(:'task', :'bob_entry', 120, current_date, 'Layout, corrected') ->> 'ok');
select 'report: ' || string_agg(right(r ->> 'user_id', 4) || ' ' || (r ->> 'minutes') || ' min in ' || (r ->> 'tasks'), '; ') from jsonb_array_elements(public.project_time_report(:'project', current_date - 1, current_date + 1)) r;
select 'bob reads the report: ' || coalesce(public.project_time_report(:'project', null, null)::text, 'null') from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000069b1', false)) x;
select 'a person brings time: ' || coalesce(public.import_task_time(:'project', '[]')::text, 'null');
reset role;
-- From the tracker: entries come with their dates and people, twice without doubling.
update public.tasks set external_key = 'TIM-1' where id = :'task';
select public.import_people(:'project', jsonb_build_array(jsonb_build_object('external_id', 'u2', 'name', 'Old Timer'))) ->> 'ok' as ignored \gset
select 'imported: ' || (public.import_task_time(:'project', jsonb_build_array(jsonb_build_object('external_key', 'TIM-1', 'entries', jsonb_build_array(
    jsonb_build_object('external_id', 'w1', 'author_ext', 'u2', 'minutes', 240, 'spent_on', '2024-03-04', 'note', 'Before the move'),
    jsonb_build_object('external_id', 'w2', 'author_ext', 'u2', 'minutes', 0, 'spent_on', '2024-03-05'))))) ->> 'entries')
  || ', again: ' || (public.import_task_time(:'project', jsonb_build_array(jsonb_build_object('external_key', 'TIM-1', 'entries', jsonb_build_array(
    jsonb_build_object('external_id', 'w1', 'author_ext', 'u2', 'minutes', 300, 'spent_on', '2024-03-04'))))) ->> 'entries');
select 'kept: ' || count(*) || ' of ' || max(minutes) || ' min, ' || to_char(max(spent_on), 'YYYY-MM-DD') || ', the project tracks time: ' || (select time_tracking from public.task_projects where id = :'project') from public.task_time_entries where external_id is not null;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000069a1';
select 'seat with time: ' || (public.seat_import_person((select id from public.task_import_people where external_id = 'u2'), '00000000-0000-0000-0000-0000000069c1') ->> 'ok');
reset role;
select 'the tracker''s time is carl''s: ' || right(user_id::text, 4) from public.task_time_entries where external_id = 'w1';
