-- Doba in a team database: the four kinds of events, free/busy, a guest, a stranger.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set gwen '00000000-0000-0000-0000-0000000000e1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_gwen 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e1","email":"gwen@client.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set seen '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_events_in(:''ws'', ''2030-01-01'', ''2030-02-01'')) x) || '' / rows: '' || (select count(*) from public.calendar_events where deleted_at is null)'
\set base '{"description": "", "location": "", "time_zone": "UTC", "all_day": false}'

set role service_role;
select 'sync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'profiles', jsonb_build_array(jsonb_build_object('id', :'gwen', 'email', 'gwen@client.test', 'name', 'Gwen')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days'))
)) ->> 'ok');
reset role;

set role authenticated;
:as_bob;
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Open", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'id' as open \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Request", "visibility": "request", "starts_at": "2030-01-11T10:00:00Z", "ends_at": "2030-01-11T11:00:00Z"}')::jsonb, '{}') ->> 'id' as request \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Invite", "visibility": "invite", "starts_at": "2030-01-12T10:00:00Z", "ends_at": "2030-01-12T11:00:00Z"}')::jsonb, '{}') ->> 'id' as invite \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Private", "visibility": "private", "starts_at": "2030-01-13T10:00:00Z", "ends_at": "2030-01-13T11:00:00Z"}')::jsonb, array[:'gwen']::uuid[]) ->> 'id' as private \gset
select 'bob sees: ' || :seen;
reset role;
set role authenticated;
:as_alice;
select 'alice (owner) sees: ' || :seen;
select 'alice opens the private one: ' || (public.calendar_event_details(:'private') ->> 'error') || ', busy slots of bob: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2030-02-01'));
select 'alice asks to join: ' || (public.respond_to_calendar_event(:'request', 'accepted') ->> 'status') || ', cancels the private one: ' || (public.cancel_calendar_event(:'private', false) ->> 'error');
reset role;
set role authenticated;
:as_bob;
select 'bob lets her in: ' || (public.decide_calendar_event_request(:'request', :'alice', true) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice hears: ' || string_agg(n ->> 'kind' || ' ' || (n #>> '{event,title}'), ', ' order by n ->> 'kind') from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') n where n ? 'event' and n -> 'event' <> 'null';
reset role;
set role authenticated;
:as_gwen;
select 'gwen (guest) sees: ' || :seen;
select 'gwen creates: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "G", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'error')
  || ', busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2030-02-01'));
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees: ' || :seen || ', joins: ' || (public.respond_to_calendar_event(:'open', 'accepted') ->> 'error') || ', busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2030-02-01'));
insert into public.calendar_events (workspace_id, title, starts_at, ends_at) values (:'ws', 'Direct', now(), now() + interval '1 hour');
reset role;
