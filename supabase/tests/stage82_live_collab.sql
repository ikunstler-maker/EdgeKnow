-- Real-time co-editing, phase 1: who may join a document's live channels and send on them.
-- Closed until the workspace's owner turns it on; reading for anyone who may open the
-- document; changes only from editors; viewers' cursors only while the document shows them;
-- presence for everyone with access; nothing for outsiders, other workspaces, other services.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000082a1', 'alice@live.test', now()),
 ('00000000-0000-0000-0000-0000000082b1', 'bob@live.test', now()),
 ('00000000-0000-0000-0000-0000000082d1', 'dora@live.test', now()),
 ('00000000-0000-0000-0000-0000000082f1', 'vera@live.test', now()),
 ('00000000-0000-0000-0000-0000000082c1', 'carol@other-live.test', now()),
 ('00000000-0000-0000-0000-0000000082e1', 'gwen@client-live.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082a1';
select public.create_workspace('Live') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'live.test') ->> 'ok' as ignored \gset
select public.invite_member(:'ws', 'gwen@client-live.test', 'guest', null) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082f1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082c1';
select public.create_workspace('Other live') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

-- Bob makes a deck, a design and a map; the workspace views them, Dora edits, Gwen (guest) views the deck.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000082b1';
select public.create_service_object(:'ws', 'slides', 'deck', 'Deck', '{}') ->> 'id' as deck \gset
select public.create_service_object(:'ws', 'boards', 'design', 'Design', '{}') ->> 'id' as design \gset
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map', '{}') ->> 'id' as map \gset
select public.set_service_object_workspace_role(:'deck', 'viewer') ->> 'ok' as ignored \gset
select public.set_service_object_workspace_role(:'design', 'commenter') ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'deck', '00000000-0000-0000-0000-0000000082d1', 'editor') ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'deck', '00000000-0000-0000-0000-0000000082e1', 'viewer') ->> 'ok' as ignored \gset
reset role;

-- What a person may do on a topic: read, send changes ("doc"), presence and cursors ("room").
create function pg_temp.can(person uuid, obj uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', person::text, true);
  execute 'set local role authenticated';
  r := 'read ' || public.live_channel_allowed('live:' || obj || ':doc', 'broadcast', false)::text
    || ', doc ' || public.live_channel_allowed('live:' || obj || ':doc', 'broadcast', true)::text
    || ', presence ' || public.live_channel_allowed('live:' || obj || ':room', 'presence', true)::text
    || ', cursor ' || public.live_channel_allowed('live:' || obj || ':room', 'broadcast', true)::text;
  execute 'reset role';
  return r;
end $$;
\set alice '00000000-0000-0000-0000-0000000082a1'
\set bob '00000000-0000-0000-0000-0000000082b1'
\set dora '00000000-0000-0000-0000-0000000082d1'
\set vera '00000000-0000-0000-0000-0000000082f1'
\set carol '00000000-0000-0000-0000-0000000082c1'
\set gwen '00000000-0000-0000-0000-0000000082e1'

select 'switch off, bob (owner of the deck): ' || pg_temp.can(:'bob', :'deck');

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob (not the workspace owner) turns it on: ' || public.set_live_collab(:'ws', true)::text;
set request.jwt.claim.sub = :'alice';
select 'alice (workspace owner) turns it on: ' || public.set_live_collab(:'ws', true)::text;
reset role;

select 'bob, deck owner: ' || pg_temp.can(:'bob', :'deck');
select 'alice, workspace owner: ' || pg_temp.can(:'alice', :'deck');
select 'dora, editor: ' || pg_temp.can(:'dora', :'deck');
select 'vera, viewer: ' || pg_temp.can(:'vera', :'deck');
select 'gwen, guest viewer: ' || pg_temp.can(:'gwen', :'deck');
select 'vera, commenter on the design: ' || pg_temp.can(:'vera', :'design');
select 'gwen, guest without the design: ' || pg_temp.can(:'gwen', :'design');
select 'carol, other workspace: ' || pg_temp.can(:'carol', :'deck');
select 'bob, a map (not in phase 1): ' || pg_temp.can(:'bob', :'map');

set role authenticated;
set request.jwt.claim.sub = :'vera';
select 'vera (viewer) shows viewers'' cursors: ' || public.set_live_viewer_cursors(:'deck', true)::text;
set request.jwt.claim.sub = :'dora';
select 'dora (editor) shows viewers'' cursors: ' || public.set_live_viewer_cursors(:'deck', true)::text;
set request.jwt.claim.sub = :'carol';
select 'carol (outsider) hides them: ' || public.set_live_viewer_cursors(:'deck', false)::text;
reset role;
select 'vera, viewer, cursors shown: ' || pg_temp.can(:'vera', :'deck');
select 'gwen, guest, cursors shown: ' || pg_temp.can(:'gwen', :'deck');
select 'vera, commenter on the design (not shown there): ' || pg_temp.can(:'vera', :'design');

select 'odd topics: ' || public.live_channel_allowed('live:' || :'deck' || ':other', 'broadcast', false)::text
  || ' ' || public.live_channel_allowed('live:' || :'deck', 'broadcast', false)::text
  || ' ' || public.live_channel_allowed(null, 'broadcast', false)::text;
select 'anon may call the check: ' || has_function_privilege('anon', 'public.live_channel_allowed(text, text, boolean)', 'execute');

-- The same through Realtime's own table, as Realtime asks it.
insert into realtime.messages (topic, extension) values ('live:' || :'deck' || ':doc', 'broadcast');
set role authenticated;
select set_config('realtime.topic', 'live:' || :'deck' || ':doc', false) as ignored \gset
set request.jwt.claim.sub = :'vera';
select 'vera reads the deck channel: ' || count(*) from realtime.messages where topic = 'live:' || :'deck' || ':doc';
select 'vera sends a change (refused):';
insert into realtime.messages (topic, extension) values ('live:' || :'deck' || ':doc', 'broadcast');
set request.jwt.claim.sub = :'dora';
insert into realtime.messages (topic, extension) values ('live:' || :'deck' || ':doc', 'broadcast') returning 'dora sends a change: ok';
set request.jwt.claim.sub = :'carol';
select 'carol reads the deck channel: ' || count(*) from realtime.messages where topic = 'live:' || :'deck' || ':doc';
reset role;

-- In the bin: closed for everyone. Switch off: closed again.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.trash_service_object(:'design', false) ->> 'ok' as ignored \gset
reset role;
select 'design in the bin, bob: ' || pg_temp.can(:'bob', :'design');
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice turns it off: ' || (public.set_live_collab(:'ws', false) ->> 'ok');
reset role;
select 'switch off again, bob: ' || pg_temp.can(:'bob', :'deck');
select 'to the team database: ' || (public.team_sync_payload(:'ws') -> 'settings')::text;
