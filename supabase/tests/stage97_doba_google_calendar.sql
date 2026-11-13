-- DOBA-1, phase 3c: a calendar connected by signing in with the provider. Titles of a
-- person's outside events are theirs alone; colleagues get plain busy time and only for
-- busy slots; the connection and link tables are closed; the list of a person's Doba
-- events is for the server only; leaving the workspace keeps a sign-in for the server to
-- take back at the provider, while a feed address goes at once.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000096a1', 'alice@gcal.test', now()),
 ('00000000-0000-0000-0000-0000000096b1', 'bob@gcal.test', now()),
 ('00000000-0000-0000-0000-0000000096c1', 'carl@gcal.test', now()),
 ('00000000-0000-0000-0000-0000000096e1', 'gwen@client-gcal.test', now());
\set alice '00000000-0000-0000-0000-0000000096a1'
\set bob '00000000-0000-0000-0000-0000000096b1'
\set carl '00000000-0000-0000-0000-0000000096c1'
\set gwen '00000000-0000-0000-0000-0000000096e1'
\set base '{"description": "Secret notes", "location": "Room 1", "time_zone": "Europe/Kyiv", "all_day": false, "visibility": "invite"}'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Signed in') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'gcal.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carl';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-gcal.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Bob organizes two events and invites Carl to both; Carl declines the second.
set request.jwt.claim.sub = :'bob';
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'Planning', 'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour', 'meeting_url', 'https://meet.example.test/abc'))::jsonb, array[:'carl']::uuid[]) ->> 'id' as planning \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || jsonb_build_object('title', 'Review', 'starts_at', now() + interval '3 days', 'ends_at', now() + interval '3 days 1 hour'))::jsonb, array[:'carl']::uuid[]) ->> 'id' as review \gset
set request.jwt.claim.sub = :'carl';
select 'carl declines the review: ' || coalesce(public.respond_to_calendar_event(:'review', 'declined') ->> 'status', 'error');

-- Nobody but the server lists a person's events or touches the connection tables.
set request.jwt.claim.sub = :'bob';
select 'bob lists his own events:';
select public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days');
select 'bob reads the links:';
select count(*) from public.calendar_external_links;
select 'bob reads the connections:';
select count(*) from public.calendar_connections;
reset role;

-- As the server.
select 'bob''s events: ' || (select string_agg(x ->> 'title', ', ' order by x ->> 'starts_at') from jsonb_array_elements(public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days')) x);
select 'carl''s events: ' || (select string_agg(x ->> 'title', ', ' order by x ->> 'starts_at') from jsonb_array_elements(public.calendar_person_events(:'ws', :'carl', now(), now() + interval '90 days')) x);
select 'their fields: ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days') -> 0) k);
select 'for the guest: ' || coalesce(public.calendar_person_events(:'ws', :'gwen', now(), now() + interval '90 days')::text, 'null')
  || ', a range too long: ' || coalesce(public.calendar_person_events(:'ws', :'bob', now(), now() + interval '200 days')::text, 'null');

-- A sign-in connection needs its access and no address; a feed one the other way round.
select 'a sign-in without access:';
insert into public.calendar_connections (workspace_id, user_id, kind) values (:'ws', :'bob', 'google');
select 'a sign-in with an address too:';
insert into public.calendar_connections (workspace_id, user_id, kind, url_encrypted, token_encrypted) values (:'ws', :'bob', 'google', 'v3.cal.a.b.c', 'v3.cal.x.y.z');
insert into public.calendar_connections (workspace_id, user_id, kind, token_encrypted, account_email, doba_calendar_id) values (:'ws', :'bob', 'google', 'v3.cal.x.y.z', 'bob@gcal.test', 'cal-1');
insert into public.calendar_connections (workspace_id, user_id, url_encrypted) values (:'ws', :'carl', 'v3.cal.a.b.c');
insert into public.calendar_external_links (workspace_id, user_id, item, event_id, remote_id, fingerprint, starts_at) values (:'ws', :'bob', :'planning', :'planning', 'remote-1', 'f1', now());
select 'a link to nobody''s connection:';
insert into public.calendar_external_links (workspace_id, user_id, item, event_id, remote_id, fingerprint, starts_at) values (:'ws', :'gwen', :'planning', :'planning', 'remote-1', 'f1', now());

-- Bob's outside events: one busy with a title, one free.
select 'kept for bob: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(
  jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour', 'title', 'Dentist', 'busy', true),
  jsonb_build_object('starts_at', now() + interval '4 days', 'ends_at', now() + interval '4 days 1 hour', 'title', 'Lunch maybe', 'busy', false),
  jsonb_build_object('starts_at', now() + interval '5 days', 'ends_at', now() + interval '5 days 1 hour', 'title', repeat('x', 400))));
select 'the long title kept: ' || (select char_length(title) from public.calendar_external_busy where user_id = :'bob' and title like 'xxx%');

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob reads his own: ' || (select string_agg(coalesce(left(title, 12), '-') || '/' || busy, ', ' order by starts_at) from public.calendar_external_busy);
set request.jwt.claim.sub = :'alice';
select 'alice sees bob busy (outside only, beyond his own events): ' || (select count(*) from jsonb_array_elements(public.calendar_busy(:'ws', array[:'bob']::uuid[], now(), now() + interval '30 days')) x where (x ->> 'starts_at')::timestamptz < now() + interval '1 day 2 hours' or (x ->> 'starts_at')::timestamptz > now() + interval '3 days 12 hours');
select 'any title in what alice gets: ' || (public.calendar_busy(:'ws', array[:'bob']::uuid[], now(), now() + interval '30 days')::text ilike '%dentist%');
select 'alice reads bob''s rows: ' || (select count(*) from public.calendar_external_busy);
reset role;

-- Bob and Carl leave: Carl's feed address goes at once; Bob's sign-in and its link stay
-- for the server (which revokes it), but nothing is read or listed for him any more.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice removes bob: ' || (public.remove_member(:'ws', :'bob') ->> 'ok') || ', carl: ' || (public.remove_member(:'ws', :'carl') ->> 'ok');
reset role;
select 'connections left: ' || (select string_agg(kind, ',') from public.calendar_connections where workspace_id = :'ws')
  || ', links: ' || (select count(*) from public.calendar_external_links where workspace_id = :'ws')
  || ', bob''s outside rows: ' || (select count(*) from public.calendar_external_busy where user_id = :'bob');
select 'bob''s events now: ' || coalesce(public.calendar_person_events(:'ws', :'bob', now(), now() + interval '90 days')::text, 'null')
  || ', kept for him: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour')));
-- The server takes the access back and removes the connection: its links go with it.
delete from public.calendar_connections where workspace_id = :'ws' and user_id = :'bob';
select 'links after: ' || (select count(*) from public.calendar_external_links where workspace_id = :'ws');
