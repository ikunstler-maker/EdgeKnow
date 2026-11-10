-- Doba, phase 3a: a person's calendar feed. Only the server reads it, by the hash of the
-- secret; it holds the person's own events and approved time off; a new address kills
-- the old one; a removed member's feed gives nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000060a1', 'alice@feed.test', now()),
 ('00000000-0000-0000-0000-0000000060b1', 'bob@feed.test', now()),
 ('00000000-0000-0000-0000-0000000060c1', 'carol@feed.test', now()),
 ('00000000-0000-0000-0000-0000000060f1', 'eve@other-feed.test', now());
\set alice '00000000-0000-0000-0000-0000000060a1'
\set bob '00000000-0000-0000-0000-0000000060b1'
\set carol '00000000-0000-0000-0000-0000000060c1'
\set eve '00000000-0000-0000-0000-0000000060f1'
\set h1 '1111111111111111111111111111111111111111111111111111111111111111'
\set h2 '2222222222222222222222222222222222222222222222222222222222222222'
\set h3 '3333333333333333333333333333333333333333333333333333333333333333'
\set titles '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(f -> ''events'') x)'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Feeds') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'feed.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset

-- Alice: a meeting with Bob, one Bob will decline, a private one without him, an open
-- one he never joined, an old one (before the feed's period) and a weekly series.
set request.jwt.claim.sub = :'alice';
select jsonb_build_object('description', 'Secret notes', 'location', 'Room 1', 'time_zone', 'UTC', 'all_day', false, 'visibility', 'invite') as base \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'With Bob', 'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour'), array[:'bob']::uuid[]) ->> 'id' as with_bob \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Declined', 'starts_at', now() + interval '3 days', 'ends_at', now() + interval '3 days 1 hour'), array[:'bob']::uuid[]) ->> 'id' as declined \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Private', 'visibility', 'private', 'starts_at', now() + interval '4 days', 'ends_at', now() + interval '4 days 1 hour'), '{}') ->> 'id' as ignored \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Open to all', 'visibility', 'open', 'starts_at', now() + interval '5 days', 'ends_at', now() + interval '5 days 1 hour'), '{}') ->> 'id' as ignored \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Long ago', 'starts_at', now() - interval '90 days', 'ends_at', now() - interval '90 days' + interval '1 hour'), array[:'bob']::uuid[]) ->> 'id' as ignored \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Weekly', 'starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour', 'repeat', jsonb_build_object('freq', 'weekly', 'count', 3)), array[:'bob']::uuid[]) ->> 'id' as weekly \gset
select public.save_leave_policy(:'ws', null, '{"name": "Vacation", "kind": "other", "days_per_year": 30, "count_days": "calendar", "requires_approval": false, "allow_negative": true}') ->> 'id' as vacation \gset
select public.save_leave_policy(:'ws', null, '{"name": "Asked", "kind": "other", "days_per_year": 30, "count_days": "calendar", "allow_negative": true}') ->> 'id' as asked \gset
select public.request_leave(:'ws', :'vacation', current_date + 20, current_date + 22, null, null, '') ->> 'ok' as ignored \gset

set request.jwt.claim.sub = :'bob';
select public.respond_to_calendar_event(:'declined', 'declined') ->> 'ok' as ignored \gset
select public.request_leave(:'ws', :'vacation', current_date + 10, current_date + 12, null, null, 'family') ->> 'ok' as ignored \gset
select public.request_leave(:'ws', :'asked', current_date + 30, current_date + 31, null, null, '') ->> 'ok' as ignored \gset

select 'bob before: ' || public.my_calendar_feed(:'ws')::text;
select 'a bad hash: ' || (public.set_calendar_feed(:'ws', 'abc') ->> 'error') || ', a good one: ' || (public.set_calendar_feed(:'ws', :'h1') ->> 'ok');
select 'bob after, has a date: ' || ((public.my_calendar_feed(:'ws') ->> 'created_at') is not null);
select 'bob reads the table:';
select count(*) from public.calendar_feeds;
select 'bob reads the feed himself:';
select public.calendar_feed(:'ws', :'h1');
set request.jwt.claim.sub = :'eve';
select 'eve (not a member) asks: ' || (public.my_calendar_feed(:'ws') ->> 'error') || ', sets: ' || (public.set_calendar_feed(:'ws', :'h3') ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol takes bob''s hash: ' || (public.set_calendar_feed(:'ws', :'h1') ->> 'error');
reset role;
set role anon;
select 'anyone reads the feed:';
select public.calendar_feed(:'ws', :'h1');
reset role;

-- As the server (the database owner here: a plain test database has no server role).
select 'bob''s feed: ' || :titles || '; leave: ' || (select string_agg(l ->> 'name', ', ') from jsonb_array_elements(f -> 'leave') l)
  || '; a description inside: ' || (f::text like '%Secret notes%')
  from public.calendar_feed(:'ws', :'h1') f;
select 'a wrong hash: ' || coalesce(public.calendar_feed(:'ws', :'h2')::text, 'nothing') || ', bob''s hash in another workspace: ' || coalesce(public.calendar_feed(:'other', :'h1')::text, 'nothing');
reset role;

-- A new address: the old one is dead.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob gets a new address: ' || (public.set_calendar_feed(:'ws', :'h2') ->> 'ok');
reset role;
select 'the old address: ' || coalesce(public.calendar_feed(:'ws', :'h1')::text, 'nothing') || ', the new one has events: ' || (jsonb_array_length(public.calendar_feed(:'ws', :'h2') -> 'events') > 0);
reset role;

-- Removed from the workspace: the feed gives nothing; turned off: the row is gone.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice removes bob: ' || (public.remove_member(:'ws', :'bob') ->> 'ok');
reset role;
select 'a removed member''s feed: ' || coalesce(public.calendar_feed(:'ws', :'h2')::text, 'nothing');
reset role;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice turns hers on: ' || (public.set_calendar_feed(:'ws', :'h3') ->> 'ok');
reset role;
select 'alice''s feed (the organizer): ' || :titles || '; leave: ' || jsonb_array_length(f -> 'leave') from public.calendar_feed(:'ws', :'h3') f;
reset role;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice turns it off: ' || (public.drop_calendar_feed(:'ws') ->> 'ok');
select 'alice now: ' || public.my_calendar_feed(:'ws')::text;
reset role;
select 'alice''s rows left: ' || count(*) from public.calendar_feeds where workspace_id = :'ws' and user_id = :'alice';
