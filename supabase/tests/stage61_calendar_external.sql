-- Doba, phase 3b: busy time from an outside calendar. Only the server writes it; colleagues
-- get anonymous busy slots; a guest and a stranger get nothing; the address table is
-- closed; leaving the workspace removes both.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000061a1', 'alice@ext.test', now()),
 ('00000000-0000-0000-0000-0000000061b1', 'bob@ext.test', now()),
 ('00000000-0000-0000-0000-0000000061e1', 'gwen@client-ext.test', now()),
 ('00000000-0000-0000-0000-0000000061f1', 'eve@other-ext.test', now());
\set alice '00000000-0000-0000-0000-0000000061a1'
\set bob '00000000-0000-0000-0000-0000000061b1'
\set gwen '00000000-0000-0000-0000-0000000061e1'
\set eve '00000000-0000-0000-0000-0000000061f1'
\set busy_of_bob 'jsonb_array_length(public.calendar_busy(:''ws'', array[:''bob'']::uuid[], now(), now() + interval ''30 days''))'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Outside') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'ext.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-ext.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset

-- Nobody but the server writes.
set request.jwt.claim.sub = :'bob';
select 'bob writes his own slots:';
select public.set_calendar_external_busy(:'ws', :'bob', '[]');
select 'bob inserts a row:';
insert into public.calendar_external_busy (workspace_id, user_id, starts_at, ends_at) values (:'ws', :'bob', now() + interval '1 day', now() + interval '1 day 1 hour');
select 'bob reads the addresses:';
select count(*) from public.calendar_connections;
reset role;

-- As the server (the database owner here): three slots, one already over, one upside down.
insert into public.calendar_connections (workspace_id, user_id, url_encrypted) values (:'ws', :'bob', 'v3.cal.x.y.z');
select 'kept for bob: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(
  jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour'),
  jsonb_build_object('starts_at', date_trunc('day', now()) + interval '3 days', 'ends_at', date_trunc('day', now()) + interval '4 days', 'all_day', true),
  jsonb_build_object('starts_at', now() - interval '2 days', 'ends_at', now() - interval '1 day'),
  jsonb_build_object('starts_at', now() + interval '5 days', 'ends_at', now() + interval '4 days')));
select 'kept for the guest: ' || public.set_calendar_external_busy(:'ws', :'gwen', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour')))
  || ', for a stranger: ' || public.set_calendar_external_busy(:'ws', :'eve', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour')));

set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice sees bob busy: ' || :busy_of_bob || ' slots, their fields: ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(public.calendar_busy(:'ws', array[:'bob']::uuid[], now(), now() + interval '30 days') -> 0) k);
select 'alice reads bob''s rows directly: ' || (select count(*) from public.calendar_external_busy);
set request.jwt.claim.sub = :'bob';
select 'bob reads his own rows: ' || (select count(*) from public.calendar_external_busy);
set request.jwt.claim.sub = :'gwen';
select 'the guest sees bob busy: ' || :busy_of_bob || ', rows: ' || (select count(*) from public.calendar_external_busy);
set request.jwt.claim.sub = :'eve';
select 'a stranger sees bob busy: ' || :busy_of_bob || ', rows: ' || (select count(*) from public.calendar_external_busy);
reset role;

-- A refresh replaces everything; an empty list clears.
select 'after a refresh with one slot: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 2 hours')));
select 'rows now: ' || count(*) from public.calendar_external_busy where user_id = :'bob';

-- Removed from the workspace: the slots and the address go at once.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice removes bob: ' || (public.remove_member(:'ws', :'bob') ->> 'ok');
reset role;
select 'bob''s slots left: ' || (select count(*) from public.calendar_external_busy where user_id = :'bob') || ', addresses left: ' || (select count(*) from public.calendar_connections where user_id = :'bob');
select 'kept for a removed member: ' || public.set_calendar_external_busy(:'ws', :'bob', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 1 hour')));
