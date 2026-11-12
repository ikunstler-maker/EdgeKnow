-- Real-time co-editing in a team database: the switch comes from the central service; the
-- same channel rules as centrally; and only a token from our issuer for this workspace
-- (Realtime does not pass through the API's token guard).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set issuer 'https://wiki.test/oidc'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set dave '00000000-0000-0000-0000-0000000000d7'
\set gwen '00000000-0000-0000-0000-0000000000e7'

create function pg_temp.sync(live boolean) returns text language sql as $$
  select public.team_sync(jsonb_build_object(
    'workspace', jsonb_build_object('id', '00000000-0000-0000-0000-0000000000f1', 'short_id', 'team0001', 'name', 'Team', 'owner_id', '00000000-0000-0000-0000-0000000000a1', 'storage_limit_mb', 50),
    'settings', jsonb_build_object('issuer', 'https://wiki.test/oidc', 'files_on_drive', false, 'live_collab', live),
    'profiles', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-0000-0000-0000000000d7', 'email', 'dave.live@team.test', 'name', 'Dave'),
      jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e7', 'email', 'gwen.live@client.test', 'name', 'Gwen')),
    'members', jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'role', 'owner', 'joined_via', 'creator'),
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000b1', 'role', 'member', 'joined_via', 'domain'),
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000d7', 'role', 'member', 'joined_via', 'domain'),
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000e7', 'role', 'guest', 'joined_via', 'invite'))
  )) ->> 'ok';
$$;
-- Acts as a person with a token: from our issuer for a workspace, or another one.
create function pg_temp.as_person(person uuid, iss text default 'https://wiki.test/oidc', ws text default '00000000-0000-0000-0000-0000000000f1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', person::text, false),
         set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('iss', iss, 'role', 'authenticated', 'sub', person, 'ek_workspace', ws))::text, false);
$$;
create function pg_temp.can(obj uuid) returns text language sql as $$
  select 'read ' || public.live_channel_allowed('live:' || obj || ':doc', 'broadcast', false)::text
    || ', doc ' || public.live_channel_allowed('live:' || obj || ':doc', 'broadcast', true)::text
    || ', presence ' || public.live_channel_allowed('live:' || obj || ':room', 'presence', true)::text
    || ', cursor ' || public.live_channel_allowed('live:' || obj || ':room', 'broadcast', true)::text;
$$;

set role service_role;
select 'sync, switch off: ' || pg_temp.sync(false);
reset role;
select pg_temp.as_person(:'bob') as ignored \gset
set role authenticated;
select public.create_service_object(:'ws', 'slides', 'deck', 'Team deck', '{}') ->> 'id' as deck \gset
select public.set_service_object_workspace_role(:'deck', 'viewer') ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'deck', :'dave', 'editor') ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'deck', :'gwen', 'viewer') ->> 'ok' as ignored \gset
select 'switch off, bob (owner of the deck): ' || pg_temp.can(:'deck');
reset role;

set role service_role;
select 'sync, switch on: ' || pg_temp.sync(true);
reset role;
select pg_temp.as_person(:'bob') as ignored \gset
set role authenticated;
select 'bob, deck owner: ' || pg_temp.can(:'deck');
reset role;
select pg_temp.as_person(:'dave') as ignored \gset
set role authenticated;
select 'dave, editor: ' || pg_temp.can(:'deck');
reset role;
select pg_temp.as_person(:'alice') as ignored \gset
set role authenticated;
select 'alice, workspace owner: ' || pg_temp.can(:'deck');
reset role;
select pg_temp.as_person(:'gwen') as ignored \gset
set role authenticated;
select 'gwen, guest viewer: ' || pg_temp.can(:'deck');
select 'gwen shows viewers'' cursors: ' || (public.set_live_viewer_cursors(:'deck', true) ->> 'error');
reset role;
select pg_temp.as_person(:'dave') as ignored \gset
set role authenticated;
select 'dave shows viewers'' cursors: ' || (public.set_live_viewer_cursors(:'deck', true) ->> 'ok');
reset role;
select pg_temp.as_person(:'gwen') as ignored \gset
set role authenticated;
select 'gwen, cursors shown: ' || pg_temp.can(:'deck');
reset role;

select pg_temp.as_person(:'bob', 'https://elsewhere.test/oidc') as ignored \gset
set role authenticated;
select 'bob, token from another issuer: ' || pg_temp.can(:'deck');
reset role;
select pg_temp.as_person(:'bob', :'issuer', '00000000-0000-0000-0000-0000000000f9') as ignored \gset
set role authenticated;
select 'bob, token for another workspace: ' || pg_temp.can(:'deck');
reset role;
select pg_temp.as_person(:'bob', :'issuer', null) as ignored \gset
set role authenticated;
select 'bob, token without a workspace: ' || pg_temp.can(:'deck');
reset role;

-- Through Realtime's own table.
select pg_temp.as_person(:'gwen') as ignored \gset
select set_config('realtime.topic', 'live:' || :'deck' || ':doc', false) as ignored \gset
set role authenticated;
select 'gwen sends a change (refused):';
insert into realtime.messages (topic, extension) values ('live:' || :'deck' || ':doc', 'broadcast');
reset role;
select pg_temp.as_person(:'dave') as ignored \gset
set role authenticated;
insert into realtime.messages (topic, extension) values ('live:' || :'deck' || ':doc', 'broadcast') returning 'dave sends a change: ok';
reset role;

set role service_role;
select 'sync, switch off again: ' || pg_temp.sync(false);
reset role;
select pg_temp.as_person(:'bob') as ignored \gset
set role authenticated;
select 'bob, switch off: ' || pg_temp.can(:'deck');
select 'bin: ' || (public.trash_service_object(:'deck', false) ->> 'ok');
reset role;
