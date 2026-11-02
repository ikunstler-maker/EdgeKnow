-- Guests in a team database (step Г1): copied from the central service with
-- their date; the same rules as centrally.
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

set role service_role;
select 'sync with a guest: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'profiles', jsonb_build_array(jsonb_build_object('id', :'gwen', 'email', 'gwen@client.test', 'name', 'Gwen')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days'))
)) ->> 'ok');
select 'gwen here: ' || role || ' ' || (access_until > now()) from public.workspace_members where user_id = :'gwen';
reset role;

set role authenticated;
:as_bob;
select public.create_page(:'ws', null, 'Team, open') ->> 'id' as open_page \gset
select public.set_page_workspace_role(:'open_page', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Team, for the client') ->> 'id' as shared \gset
select 'shared with gwen: ' || (public.set_page_member_role(:'shared', :'gwen', 'editor') ->> 'ok');
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Team plan', '{}') ->> 'id' as map \gset
select 'a map never owned by a guest: ' || (public.set_service_object_member_role(:'map', :'gwen', 'owner') ->> 'error');
reset role;
set role authenticated;
:as_gwen;
select 'gwen sees pages: ' || string_agg(title, ', ' order by title) from public.pages where title like 'Team,%';
select 'gwen sees maps: ' || count(*) from public.service_objects;
select 'gwen sees projects: ' || count(*) from public.task_projects;
select 'gwen makes a page: ' || (public.create_page(:'ws', null, 'Mine') ->> 'error');
select 'gwen makes a map: ' || (public.create_service_object(:'ws', 'nodes', 'mindmap', 'x', '{}') ->> 'error');
select 'gwen sees groups: ' || count(*) from public.workspace_groups;
select 'gwen sees these members: ' || string_agg(user_id::text, ', ' order by user_id) from public.workspace_members;
reset role;

set role service_role;
select 'sync after the date: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() - interval '1 minute'))
)) ->> 'ok');
reset role;
set role authenticated;
:as_gwen;
select 'after the date gwen sees: ' || count(*) || ' pages, member: ' || public.is_workspace_member(:'ws') from public.pages;
reset role;

-- Gone again (next sync without her): the database is as before this test.
set role service_role;
select 'sync without gwen: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'))
)) ->> 'ok');
select 'gwen''s grants gone: ' || count(*) from public.page_access where user_id = :'gwen';
reset role;
