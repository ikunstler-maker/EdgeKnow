-- Groups in a team database: they arrive only with the central sync, give their
-- members the role on a page and its subpages, and go with the next sync.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set issuer 'https://wiki.test/oidc'
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set carol '00000000-0000-0000-0000-0000000000c1'
\set grp '00000000-0000-0000-0000-0000000000e1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test"}'''

set role service_role;
select 'sync with a group: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'carol', 'role', 'member', 'joined_via', 'invite')),
  'groups', jsonb_build_array(jsonb_build_object('id', :'grp', 'name', 'Editors')),
  'group_members', jsonb_build_array(jsonb_build_object('group_id', :'grp', 'user_id', :'bob'))
)) ->> 'ok');
reset role;

set role authenticated;
:as_alice;
select public.create_page(:'ws', null, 'Group page') ->> 'id' as page \gset
select public.create_page(:'ws', :'page', 'Group subpage') ->> 'id' as child \gset
select 'give the group viewer: ' || public.set_page_group_role(:'page', :'grp', 'viewer')::text;
select 'groups to choose: ' || (select string_agg(g ->> 'name', ', ') from jsonb_array_elements(public.page_sharing(:'page') -> 'all_groups') g);
reset role;
set role authenticated;
:as_bob;
select 'bob: ' || coalesce(public.effective_role(:'page'), 'none') || ', ' || coalesce(public.effective_role(:'child'), 'none');
reset role;
set role authenticated;
:as_carol;
select 'carol: ' || coalesce(public.effective_role(:'page'), 'none');
reset role;

-- People can't make groups here; only the sync does.
\set ON_ERROR_STOP 0
set role authenticated;
:as_alice;
insert into public.workspace_groups (workspace_id, name) values (:'ws', 'Local');
insert into public.workspace_group_members (group_id, workspace_id, user_id) values (:'grp', :'ws', :'carol');
reset role;
\set ON_ERROR_STOP 1

-- The group is gone centrally: so are its grants, and Bob's access.
set role service_role;
select 'sync without it: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'groups', '[]'::jsonb, 'group_members', '[]'::jsonb
)) ->> 'ok');
reset role;
select 'grants left: ' || count(*) from public.page_group_access;
set role authenticated;
:as_bob;
select 'bob after: ' || coalesce(public.effective_role(:'page'), 'none');
reset role;
