-- Phase 3a in a team database: a person's feed is read by the server alone, holds only
-- that person's events, and a stranger gets none.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set h1 '9999999999999999999999999999999999999999999999999999999999999991'
\set h2 '9999999999999999999999999999999999999999999999999999999999999992'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_alice;
select jsonb_build_object('description', 'Hidden text', 'location', '', 'time_zone', 'UTC', 'all_day', false, 'visibility', 'private') as base \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Feed: with Bob', 'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour'), array[:'bob']::uuid[]) ->> 'id' as ignored \gset
select public.create_calendar_event(:'ws', :'base'::jsonb || jsonb_build_object('title', 'Feed: alone', 'starts_at', now() + interval '3 days', 'ends_at', now() + interval '3 days 1 hour'), '{}') ->> 'id' as ignored \gset
reset role;
set role authenticated;
:as_bob;
select 'bob turns the feed on: ' || (public.set_calendar_feed(:'ws', :'h1') ->> 'ok');
select 'bob reads the table:';
select count(*) from public.calendar_feeds;
select 'bob reads the feed himself:';
select public.calendar_feed(:'ws', :'h1');
reset role;
set role authenticated;
:as_zed;
select 'zed (not a member) turns one on: ' || (public.set_calendar_feed(:'ws', :'h2') ->> 'error');
reset role;
set role service_role;
select 'bob''s feed, of the two new events: ' || (select string_agg(x ->> 'title', ', ' order by x ->> 'title') from jsonb_array_elements(f -> 'events') x where x ->> 'title' like 'Feed:%')
  || '; a description inside: ' || (f::text like '%Hidden text%')
  from public.calendar_feed(:'ws', :'h1') f;
select 'a wrong hash: ' || coalesce(public.calendar_feed(:'ws', :'h2')::text, 'nothing');
reset role;
set role authenticated;
:as_bob;
select 'bob turns it off: ' || (public.drop_calendar_feed(:'ws') ->> 'ok');
reset role;
set role service_role;
select 'after that: ' || coalesce(public.calendar_feed(:'ws', :'h1')::text, 'nothing');
reset role;
