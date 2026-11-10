-- Doba, phase 1a: who sees each kind of event, who joins and how, requests to join,
-- free/busy without details, guests, an outsider, notifications, direct writes.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000053a1', 'alice@cal.test', now()),
 ('00000000-0000-0000-0000-0000000053b1', 'bob@cal.test', now()),
 ('00000000-0000-0000-0000-0000000053c1', 'carl@cal.test', now()),
 ('00000000-0000-0000-0000-0000000053d1', 'dana@cal.test', now()),
 ('00000000-0000-0000-0000-0000000053e1', 'gwen@client-cal.test', now()),
 ('00000000-0000-0000-0000-0000000053f1', 'eve@other-cal.test', now());
\set alice '00000000-0000-0000-0000-0000000053a1'
\set bob '00000000-0000-0000-0000-0000000053b1'
\set carl '00000000-0000-0000-0000-0000000053c1'
\set dana '00000000-0000-0000-0000-0000000053d1'
\set gwen '00000000-0000-0000-0000-0000000053e1'
\set eve '00000000-0000-0000-0000-0000000053f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Calendar') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'cal.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carl';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dana';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-cal.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
-- Dana is an admin.
update public.workspace_members set role = 'admin' where workspace_id = :'ws' and user_id = :'dana';

-- What a person sees: through the function and by reading the table (must be the same).
\set seen '(select coalesce(string_agg(x ->> ''title'', '', '' order by x ->> ''title''), ''nothing'') from jsonb_array_elements(public.calendar_events_in(:''ws'', ''2030-01-01'', ''2030-02-01'')) x)'
\set same '(select case when (select coalesce(array_agg((x ->> ''id'')::uuid order by x ->> ''id''), ''{}'') from jsonb_array_elements(public.calendar_events_in(:''ws'', ''2030-01-01'', ''2030-02-01'')) x) = (select coalesce(array_agg(e.id order by e.id::text), ''{}'') from public.calendar_events e where e.workspace_id = :''ws'' and e.deleted_at is null) then ''same as the table'' else ''DIFFERS from the table'' end)'
\set base '{"description": "", "location": "Room 1", "time_zone": "Europe/Kyiv", "all_day": false}'

-- Bob organizes one event of each kind; Carl is invited to the hidden ones, Gwen (a guest) to the private one.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Open", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'id' as open \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Request", "visibility": "request", "starts_at": "2030-01-11T10:00:00Z", "ends_at": "2030-01-11T11:00:00Z"}')::jsonb, '{}') ->> 'id' as request \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Invite", "visibility": "invite", "starts_at": "2030-01-12T10:00:00Z", "ends_at": "2030-01-12T11:00:00Z"}')::jsonb, array[:'carl']::uuid[]) ->> 'id' as invite \gset
select public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "Private", "visibility": "private", "starts_at": "2030-01-13T10:00:00Z", "ends_at": "2030-01-13T11:00:00Z"}')::jsonb, array[:'carl', :'gwen']::uuid[]) ->> 'id' as private \gset
select 'bob (organizer) sees: ' || :seen || ' — ' || :same;

-- Bad input.
select 'end before start: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T09:00:00Z"}')::jsonb, '{}') ->> 'error');
select 'no title: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": " ", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'error');
select 'link without https: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "meeting_url": "javascript:alert(1)", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'error');
select 'unknown kind: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "visibility": "secret", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'error');
select 'unknown time zone: ' || (public.create_calendar_event(:'ws', '{"title": "X", "visibility": "open", "time_zone": "Mars/Base", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}'::jsonb, '{}') ->> 'error');
select 'inviting an outsider: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "X", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, array[:'eve']::uuid[]) ->> 'error');

-- Who sees what.
set request.jwt.claim.sub = :'alice';
select 'alice (owner, not invited) sees: ' || :seen || ' — ' || :same;
select 'alice opens the private one: ' || (public.calendar_event_details(:'private') ->> 'error');
set request.jwt.claim.sub = :'dana';
select 'dana (admin, not invited) sees: ' || :seen || ' — ' || :same;
set request.jwt.claim.sub = :'carl';
select 'carl (invited to both hidden) sees: ' || :seen || ' — ' || :same;
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest, invited to the private one) sees: ' || :seen || ' — ' || :same;
select 'gwen creates: ' || (public.create_calendar_event(:'ws', (:'base'::jsonb || '{"title": "G", "visibility": "open", "starts_at": "2030-01-10T10:00:00Z", "ends_at": "2030-01-10T11:00:00Z"}')::jsonb, '{}') ->> 'error');
select 'gwen joins the open one: ' || (public.respond_to_calendar_event(:'open', 'accepted') ->> 'error');
select 'gwen asks who is busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2030-02-01'));
select 'gwen answers her invitation: ' || (public.respond_to_calendar_event(:'private', 'tentative') ->> 'status');
set request.jwt.claim.sub = :'eve';
select 'eve (outsider) sees: ' || :seen || ' — ' || :same || ', rows: ' || (select count(*) from public.calendar_events) || ', people: ' || (select count(*) from public.calendar_event_attendees);
select 'eve opens: ' || (public.calendar_event_details(:'open') ->> 'error') || ', joins: ' || (public.respond_to_calendar_event(:'open', 'accepted') ->> 'error')
  || ', busy: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2030-02-01'));

-- Free/busy: Alice sees neither hidden event, yet learns when Bob and Carl are busy — times only.
set request.jwt.claim.sub = :'alice';
select 'busy for alice: ' || string_agg((select split_part(p.email, '@', 1) from public.profiles p where p.id = (b ->> 'user_id')::uuid) || ' ' || to_char((b ->> 'starts_at')::timestamptz at time zone 'UTC', 'DD HH24:MI'), ', ' order by b ->> 'starts_at', b ->> 'user_id')
  || ' — keys: ' || (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.calendar_busy(:'ws', array[:'bob', :'carl']::uuid[], '2030-01-01', '2030-02-01')) y, jsonb_object_keys(y) k)
from jsonb_array_elements(public.calendar_busy(:'ws', array[:'bob', :'carl']::uuid[], '2030-01-01', '2030-02-01')) b;
select 'too wide a period: ' || jsonb_array_length(public.calendar_busy(:'ws', array[:'bob']::uuid[], '2030-01-01', '2031-01-01')) || ' / ' || jsonb_array_length(public.calendar_events_in(:'ws', '2030-01-01', '2031-01-01'));

-- Joining: open at once, "request" through the organizer, hidden ones not at all.
select 'alice joins the open one: ' || (public.respond_to_calendar_event(:'open', 'accepted') ->> 'status');
select 'alice asks to join: ' || (public.respond_to_calendar_event(:'request', 'accepted') ->> 'status');
select 'alice joins the private one: ' || (public.respond_to_calendar_event(:'private', 'accepted') ->> 'error');
select 'alice decides on her own request: ' || (public.decide_calendar_event_request(:'request', :'alice', true) ->> 'error');
set request.jwt.claim.sub = :'dana';
select 'dana asks to join: ' || (public.respond_to_calendar_event(:'request', 'accepted') ->> 'status');
select 'dana sees of the request event: ' || (select string_agg(a ->> 'name' || ' ' || (a ->> 'status'), ', ' order by a ->> 'name') from jsonb_array_elements(public.calendar_event_details(:'request') -> 'attendees') a);
select 'dana reads request rows directly: ' || (select string_agg(status, ',' order by status) from public.calendar_event_attendees where event_id = :'request');
set request.jwt.claim.sub = :'bob';
select 'bob sees requests: ' || (select x ->> 'requests' from jsonb_array_elements(public.calendar_events_in(:'ws', '2030-01-01', '2030-02-01')) x where x ->> 'id' = :'request');
select 'bob lets alice in: ' || (public.decide_calendar_event_request(:'request', :'alice', true) ->> 'ok') || ', refuses dana: ' || (public.decide_calendar_event_request(:'request', :'dana', false) ->> 'ok');
select 'bob declines his own event: ' || (public.respond_to_calendar_event(:'open', 'declined') ->> 'error');
set request.jwt.claim.sub = :'dana';
select 'dana asks again: ' || (public.respond_to_calendar_event(:'request', 'accepted') ->> 'error');

-- Changing: the organizer only. Cancelling: the organizer, and admins unless private.
set request.jwt.claim.sub = :'carl';
select 'carl (invited) edits: ' || (public.update_calendar_event(:'invite', (:'base'::jsonb || '{"title": "Hacked", "visibility": "open", "starts_at": "2030-01-12T10:00:00Z", "ends_at": "2030-01-12T11:00:00Z"}')::jsonb) ->> 'error')
  || ', invites: ' || (public.invite_to_calendar_event(:'invite', array[:'alice']::uuid[]) ->> 'error') || ', removes: ' || (public.remove_calendar_event_attendee(:'invite', :'bob') ->> 'error')
  || ', cancels: ' || (public.cancel_calendar_event(:'invite', false) ->> 'error');
select 'carl answers: ' || (public.respond_to_calendar_event(:'invite', 'declined') ->> 'status');
set request.jwt.claim.sub = :'dana';
select 'dana (admin) cancels the private one: ' || (public.cancel_calendar_event(:'private', false) ->> 'error') || ', the invite-only one: ' || (public.cancel_calendar_event(:'invite', false) ->> 'ok');
select 'dana sets working days: ' || (public.set_calendar_settings(:'ws', '{1,2,3,4}', 'Europe/Kyiv') ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob sets working days: ' || (public.set_calendar_settings(:'ws', '{1}', 'UTC') ->> 'error') || ', reads: ' || (select array_to_string(work_days, '') || ' ' || time_zone from public.calendar_settings where workspace_id = :'ws');
select 'bob after the cancel sees: ' || :seen || ' — ' || :same;
select 'bob brings it back: ' || (public.cancel_calendar_event(:'invite', true) ->> 'ok');
select 'bob moves the open one: ' || (public.update_calendar_event(:'open', (:'base'::jsonb || '{"title": "Open", "visibility": "open", "starts_at": "2030-01-10T12:00:00Z", "ends_at": "2030-01-10T13:00:00Z"}')::jsonb) ->> 'ok');
-- A "request" event made private: the requests go.
select 'bob hides the request event: ' || (public.update_calendar_event(:'request', (:'base'::jsonb || '{"title": "Request", "visibility": "private", "starts_at": "2030-01-11T10:00:00Z", "ends_at": "2030-01-11T11:00:00Z"}')::jsonb) ->> 'ok');
select 'people left: ' || (select string_agg(status, ',' order by status) from public.calendar_event_attendees where event_id = :'request');

-- Nobody writes the tables directly.
set request.jwt.claim.sub = :'bob';
insert into public.calendar_events (workspace_id, title, starts_at, ends_at) values (:'ws', 'Direct', now(), now() + interval '1 hour');
update public.calendar_events set title = 'Direct' where id = :'open';
delete from public.calendar_event_attendees where event_id = :'open';
insert into public.calendar_settings (workspace_id) values (:'other');

-- Notifications: ids only; the title is shown while the person may see the event.
set request.jwt.claim.sub = :'carl';
select 'carl hears: ' || string_agg(n ->> 'kind' || ' ' || coalesce(n #>> '{event,title}', '(hidden)') || case when (n #>> '{event,cancelled}')::boolean then ' cancelled' else '' end, ', ' order by n ->> 'kind', n #>> '{event,title}')
from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') n;
set request.jwt.claim.sub = :'alice';
select 'alice hears: ' || string_agg(n ->> 'kind' || ' ' || coalesce(n #>> '{event,title}', '(hidden)'), ', ' order by n ->> 'kind', n #>> '{event,title}')
from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') n;
set request.jwt.claim.sub = :'dana';
select 'dana (refused, the event is hidden now) hears: ' || coalesce(string_agg(n ->> 'kind' || ' ' || coalesce(n #>> '{event,title}', '(hidden)'), ', ' order by n ->> 'kind'), 'nothing')
from jsonb_array_elements(public.my_notifications(:'ws', 50) -> 'items') n;
select 'dana mutes invitations: ' || (public.set_notification_prefs(:'ws', '{event_invite}') ->> 'ok') || ', nonsense: ' || (public.set_notification_prefs(:'ws', '{event_nonsense}') ->> 'error');

-- A guest whose time is over sees nothing.
reset role;
update public.workspace_members set access_until = now() - interval '1 day' where workspace_id = :'ws' and user_id = :'gwen';
set role authenticated;
set request.jwt.claim.sub = :'gwen';
select 'gwen after her time: ' || :seen || ', rows: ' || (select count(*) from public.calendar_events) || ', opens: ' || (public.calendar_event_details(:'private') ->> 'error');

-- Old cancelled events go; an account that goes leaves the event without an organizer.
reset role;
update public.calendar_events set deleted_at = now() - interval '31 days' where id = :'invite';
select 'purged: ' || public.purge_calendar_events();
select 'people for the move include carl: ' || exists (select 1 from jsonb_array_elements(public.team_move_people(:'ws')) p where p ->> 'id' = :'carl');
select 'anon reads: ' || has_table_privilege('anon', 'public.calendar_events', 'select') || ', anon calls: ' || has_function_privilege('anon', 'public.calendar_events_in(uuid, timestamptz, timestamptz)', 'execute')
  || ', members call notify_event: ' || has_function_privilege('authenticated', 'public.notify_event(uuid, uuid, text, uuid, uuid)', 'execute');
