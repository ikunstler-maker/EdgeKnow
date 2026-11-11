-- Doba, phase 2b: Rukh due dates on the calendar (exactly what the person reads in Rukh —
-- somebody else's private task never), a unit invited to an event, events in search and chips.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000056a1', 'alice@callinks.test', now()),
 ('00000000-0000-0000-0000-0000000056b1', 'bob@callinks.test', now()),
 ('00000000-0000-0000-0000-0000000056c1', 'carol@callinks.test', now()),
 ('00000000-0000-0000-0000-0000000056d1', 'dana@callinks.test', now()),
 ('00000000-0000-0000-0000-0000000056e1', 'gwen@client-callinks.test', now()),
 ('00000000-0000-0000-0000-0000000056f1', 'eve@other-callinks.test', now());
\set alice '00000000-0000-0000-0000-0000000056a1'
\set bob '00000000-0000-0000-0000-0000000056b1'
\set carol '00000000-0000-0000-0000-0000000056c1'
\set dana '00000000-0000-0000-0000-0000000056d1'
\set gwen '00000000-0000-0000-0000-0000000056e1'
\set eve '00000000-0000-0000-0000-0000000056f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Links') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'callinks.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dana';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-callinks.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
update public.workspace_members set role = 'admin' where workspace_id = :'ws' and user_id = :'dana';

-- Two projects: one open to the workspace, one closed (Alice's own).
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_task_project(:'ws', 'Open', 'OPN', null, null) ->> 'id' as open \gset
select public.create_task_project(:'ws', 'Closed', 'CLS', null, null) ->> 'id' as closed \gset
select public.create_task(:'closed', '{"title": "In a closed project", "due_date": "2030-03-04"}') ->> 'id' as ignored \gset
reset role;
update public.task_projects set workspace_role = 'editor' where id = :'open';
update public.task_projects set workspace_role = null where id = :'closed';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.create_task(:'open', jsonb_build_object('title', 'Bob''s task', 'due_date', '2030-03-04', 'assignee_id', :'bob')) ->> 'id' as ignored \gset
select public.create_task(:'open', '{"title": "Bob private", "due_date": "2030-03-04", "private": true}') ->> 'id' as ignored \gset
select public.create_task(:'open', jsonb_build_object('title', 'Private for Carol', 'due_date', '2030-03-05', 'private', true, 'assignee_id', :'carol')) ->> 'id' as ignored \gset
select public.create_task(:'open', jsonb_build_object('title', 'Carol''s task', 'due_date', '2030-03-05', 'assignee_id', :'carol')) ->> 'id' as ignored \gset
select public.create_task(:'open', '{"title": "Nobody''s task", "due_date": "2030-03-06"}') ->> 'id' as ignored \gset
select public.create_task(:'open', '{"title": "No due date"}') ->> 'id' as ignored \gset
select public.create_task(:'open', '{"title": "Done long ago", "due_date": "2030-03-04"}') ->> 'id' as old \gset
select public.create_task(:'open', '{"title": "Done yesterday", "due_date": "2030-03-04"}') ->> 'id' as fresh \gset
select public.create_task(:'open', '{"title": "In the bin", "due_date": "2030-03-04"}') ->> 'id' as binned \gset
select public.create_task(:'open', '{"title": "Next month", "due_date": "2030-04-20"}') ->> 'id' as ignored \gset
reset role;
update public.tasks set done_at = now() - interval '20 days' where id = :'old';
update public.tasks set done_at = now() - interval '1 day' where id = :'fresh';
update public.tasks set deleted_at = now() where id = :'binned';

-- The calendar's way and reading the table (what Rukh shows): the same tasks.
\set mine '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''due_date'', x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_tasks(:''ws'', ''2030-03-01'', ''2030-03-31'', true)) x)'
\set every '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''due_date'', x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_tasks(:''ws'', ''2030-03-01'', ''2030-03-31'', false)) x)'
\set same '(select case when (select coalesce(array_agg((x ->> ''id'')::uuid order by x ->> ''id''), ''{}'') from jsonb_array_elements(public.calendar_tasks(:''ws'', ''2030-03-01'', ''2030-03-31'', false)) x) = (select coalesce(array_agg(t.id order by t.id::text), ''{}'') from public.tasks t where t.workspace_id = :''ws'' and t.deleted_at is null and t.due_date between ''2030-03-01'' and ''2030-03-31'' and (t.done_at is null or t.done_at >= now() - interval ''14 days'')) then ''same as Rukh'' else ''DIFFERS from Rukh'' end)'
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob, mine: ' || :mine;
select 'bob, all: ' || :every || ' — ' || :same;
set request.jwt.claim.sub = :'carol';
select 'carol, mine: ' || :mine;
select 'carol, all: ' || :every || ' — ' || :same;
set request.jwt.claim.sub = :'alice';
select 'alice (owner), all: ' || :every || ' — ' || :same;
set request.jwt.claim.sub = :'dana';
select 'dana (admin), all: ' || :every || ' — ' || :same;
select 'dana sees of a private one: ' || (public.calendar_tasks(:'ws', '2030-03-01', '2030-03-31', false)::text like '%rivate%');
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest), all: ' || :every || ' — ' || :same;
set request.jwt.claim.sub = :'eve';
select 'eve (outsider), all: ' || :every || ' — ' || :same;
-- Admins allowed to see private tasks: then, and only then, they are there for them.
set request.jwt.claim.sub = :'alice';
select public.set_private_tasks_admin(:'ws', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dana';
select 'dana, admins may see private: ' || :every || ' — ' || :same;
set request.jwt.claim.sub = :'bob';
select 'bob still: ' || :every || ' — ' || :same;
select 'too wide a period: ' || jsonb_array_length(public.calendar_tasks(:'ws', '2030-01-01', '2030-12-31', false)) || ', keys: '
  || (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.calendar_tasks(:'ws', '2030-03-01', '2030-03-31', false)) x, jsonb_object_keys(x) k);

-- A unit invited to an event: its people and those of the units under it; not guests,
-- not the leads above, not who already said no.
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Company', null) ->> 'id' as company \gset
select public.create_workspace_group(:'ws', 'Marketing', :'company') ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design', :'marketing') ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'company', :'dana', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'company', :'dana', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'marketing', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'carol', true) ->> 'ok' as ignored \gset
\set base '{"description": "About the launch", "location": "Blue room", "time_zone": "UTC", "all_day": false}'
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Marketing sync", "visibility": "private", "starts_at": "2030-03-10T10:00:00Z", "ends_at": "2030-03-10T11:00:00Z"}')::jsonb, '{}') ->> 'id' as sync \gset
set request.jwt.claim.sub = :'bob';
select 'bob (not the organizer) invites a unit: ' || (public.invite_unit_to_calendar_event(:'sync', :'marketing') ->> 'error') || ', refreshes: ' || (public.refresh_calendar_event_units(:'sync') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice invites Marketing: ' || (public.invite_unit_to_calendar_event(:'sync', :'marketing') ->> 'added') || ' people';
\set people '(select string_agg(split_part(p.email, ''@'', 1) || '' '' || a.status, '', '' order by p.email) from public.calendar_event_attendees a join public.profiles p on p.id = a.user_id where a.event_id = :''sync'')'
select 'in the event: ' || :people;
select 'again: ' || (public.invite_unit_to_calendar_event(:'sync', :'marketing') ->> 'added') || ', a unit of another workspace: ' || (public.invite_unit_to_calendar_event(:'sync', gen_random_uuid()) ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol says no: ' || (public.respond_to_calendar_event(:'sync', 'declined') ->> 'status');
-- Dana moves into Design; a guest is put there too. "Refresh" brings Dana in and nobody else.
set request.jwt.claim.sub = :'alice';
select public.set_workspace_group_member(:'ws', :'design', :'dana', true) ->> 'ok' as ignored \gset
reset role;
insert into public.workspace_group_members (group_id, workspace_id, user_id) values (:'design', :'ws', :'gwen');
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'refresh: ' || (public.refresh_calendar_event_units(:'sync') ->> 'added') || ' more';
select 'in the event: ' || :people;
select 'units kept: ' || cardinality(invited_group_ids) from public.calendar_events where id = :'sync';

-- Search: only what the person sees; coming events first.
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Launch party", "visibility": "open", "starts_at": "2030-03-12T18:00:00Z", "ends_at": "2030-03-12T20:00:00Z"}')::jsonb, '{}') ->> 'id' as party \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'Launch retro (weekly)', 'visibility', 'open', 'starts_at', now() - interval '21 days' + interval '2 hours', 'ends_at', now() - interval '21 days' + interval '3 hours', 'repeat', jsonb_build_object('freq', 'weekly')))::jsonb, '{}') ->> 'id' as retro \gset
\set found '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(public.search_calendar_events(:''ws'', ''launch'')) x)'
select 'alice finds “launch”: ' || :found || '; the series with a day ahead: ' || (select ((x ->> 'starts_at')::timestamptz > now())::text from jsonb_array_elements(public.search_calendar_events(:'ws', 'launch')) x where x ->> 'id' = :'retro');
select 'by the place: ' || (select string_agg(x ->> 'title', ', ' order by x ->> 'title') from jsonb_array_elements(public.search_calendar_events(:'ws', 'blue room')) x)
  || '; a wildcard is just a character: ' || jsonb_array_length(public.search_calendar_events(:'ws', '%'));
set request.jwt.claim.sub = :'bob';
select 'bob (invited to the private one) finds: ' || :found;
reset role;
delete from public.calendar_event_attendees where event_id = :'sync' and user_id = :'bob';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob, no longer invited, finds: ' || :found;
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest) finds: ' || :found;
set request.jwt.claim.sub = :'eve';
select 'eve (outsider) finds: ' || :found;

-- Chips: the title only for who sees the event; nothing at all otherwise.
\set chips '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_event_chips(array[:''sync'', :''party'']::uuid[])) x)'
set request.jwt.claim.sub = :'alice';
select 'alice''s chips: ' || :chips;
set request.jwt.claim.sub = :'bob';
select 'bob''s chips: ' || :chips;
set request.jwt.claim.sub = :'gwen';
select 'gwen''s chips: ' || :chips;
set request.jwt.claim.sub = :'eve';
select 'eve''s chips: ' || :chips;

reset role;
select 'anon calls: ' || has_function_privilege('anon', 'public.calendar_tasks(uuid, date, date, boolean)', 'execute') || ' ' || has_function_privilege('anon', 'public.search_calendar_events(uuid, text)', 'execute')
  || ' ' || has_function_privilege('anon', 'public.calendar_event_chips(uuid[])', 'execute');
