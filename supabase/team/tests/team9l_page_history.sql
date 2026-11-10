-- Page history in a team database: the same rules as supabase/tests/stage58_page_history.sql.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set carol '00000000-0000-0000-0000-0000000000c1'
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set dave '00000000-0000-0000-0000-0000000000d8'
\set as_dave 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000d8''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d8","email":"dave@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set erin '00000000-0000-0000-0000-0000000000e8'
\set as_erin 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e8''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e8","email":"erin@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set gwen '00000000-0000-0000-0000-0000000000e1'
\set as_gwen 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e1","email":"gwen@client.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role service_role;
select 'sync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'profiles', jsonb_build_array(
    jsonb_build_object('id', :'dave', 'email', 'dave@team.test', 'name', 'Dave'),
    jsonb_build_object('id', :'erin', 'email', 'erin@team.test', 'name', 'Erin')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'carol', 'role', 'admin', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'dave', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'erin', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days')),
  'groups', '[]'::jsonb, 'group_members', '[]'::jsonb
)) ->> 'ok');
reset role;

\set text_a '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"First text","styles":{}}],"children":[]}]'
\set text_b '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Second text","styles":{}}],"children":[]}]'
\set versions 'select coalesce(string_agg(reason || '':'' || coalesce(content #>> ''{0,content,0,text}'', ''-''), '', '' order by created_at, id), ''none'') from public.page_versions where page_id = :''page'''

set role authenticated;
:as_bob;
select public.create_page(:'ws', null, 'H: Handbook') ->> 'id' as page \gset
select public.set_page_workspace_role(:'page', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'dave', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'erin', 'commenter') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'gwen', 'viewer') ->> 'ok' as ignored \gset
select 'publish: ' || (public.publish_page(:'page', false) ->> 'published');
select 'bob saves twice: ' || (public.save_page_content(:'page', :'text_a'::jsonb, 1) ->> 'ok') || ' ' || (public.save_page_content(:'page', :'text_b'::jsonb, 2) ->> 'ok');
reset role;
set role authenticated;
:as_dave;
select 'dave saves: ' || (public.save_page_content(:'page', :'text_a'::jsonb, 3) ->> 'ok');
select 'dave sees: ' || (:versions);
reset role;

set role authenticated;
:as_alice;
select 'alice (workspace owner, viewer) sees: ' || (:versions);
reset role;
set role authenticated;
:as_carol;
select 'carol (admin, viewer) sees: ' || (:versions);
reset role;
set role authenticated;
:as_erin;
select 'erin (commenter) sees: ' || (:versions);
reset role;
set role authenticated;
:as_gwen;
select 'gwen (guest viewer) sees: ' || (:versions);
reset role;
select id as v_first from public.page_versions where page_id = :'page' order by created_at, id limit 1 \gset
set role authenticated;
:as_erin;
select 'erin restores: ' || (public.restore_page_version(:'v_first')::text);
reset role;
set role authenticated;
:as_carol;
select 'carol restores: ' || (public.restore_page_version(:'v_first')::text);
reset role;
set role authenticated;
:as_dave;
select 'dave restores the first version: ' || (public.restore_page_version(:'v_first') ->> 'ok');
\set ON_ERROR_STOP 0
delete from public.page_versions where page_id = :'page';
\set ON_ERROR_STOP 1
reset role;
select 'latest: ' || reason || ', versions: ' || (select count(*) from public.page_versions where page_id = :'page') from public.page_versions where page_id = :'page' order by created_at desc, id desc limit 1;
update public.page_versions set created_at = now() - interval '30 days' where page_id = :'page';
select 'pruned: ' || (public.prune_all_page_versions() > 0);
select 'left: ' || count(*) from public.page_versions where page_id = :'page';
