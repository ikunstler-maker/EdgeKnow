-- Wiki drafts in a team database: the same rules as supabase/tests/stage55_page_drafts.sql.
-- A draft is seen by its owner, people invited to it and the workspace owner only;
-- admins, units, whole-workspace access, the owner of a published parent and
-- non-members see nothing until it is published by its owner or an editor.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set grp '00000000-0000-0000-0000-0000000000a9'
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
\set frank '00000000-0000-0000-0000-0000000000f8'
\set as_frank 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000f8''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f8","email":"frank@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set gwen '00000000-0000-0000-0000-0000000000e1'
\set as_gwen 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e1","email":"gwen@client.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set hank '00000000-0000-0000-0000-0000000000e9'
\set as_hank 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000e9''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e9","email":"hank@client.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role service_role;
select 'sync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'profiles', jsonb_build_array(
    jsonb_build_object('id', :'dave', 'email', 'dave@team.test', 'name', 'Dave'),
    jsonb_build_object('id', :'erin', 'email', 'erin@team.test', 'name', 'Erin'),
    jsonb_build_object('id', :'frank', 'email', 'frank@team.test', 'name', 'Frank'),
    jsonb_build_object('id', :'hank', 'email', 'hank@client.test', 'name', 'Hank')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'carol', 'role', 'admin', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'dave', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'erin', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'frank', 'role', 'member', 'joined_via', 'invite'),
    jsonb_build_object('user_id', :'gwen', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days'),
    jsonb_build_object('user_id', :'hank', 'role', 'guest', 'joined_via', 'invite', 'access_until', now() + interval '7 days')),
  'groups', jsonb_build_array(jsonb_build_object('id', :'grp', 'name', 'Design')),
  'group_members', jsonb_build_array(jsonb_build_object('group_id', :'grp', 'user_id', :'frank'))
)) ->> 'ok');
reset role;

\set titles 'select coalesce(string_agg(title, '', '' order by title), ''nothing'') from public.pages where workspace_id = :''ws'' and title like ''D:%'''
\set tree 'select coalesce(string_agg(title || case when draft then ''*'' else '''' end, '', '' order by title), ''nothing'') from public.my_page_tree(:''ws'') where title like ''D:%'''
\set old 'select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, public.my_role(p) as my_role, public.shared_with_workspace(p) as shared_with_workspace, p.ack_label, public.is_draft(p) as draft from public.pages p where p.workspace_id = :''ws'' and p.deleted_at is null'
\set new 'select * from public.my_page_tree(:''ws'')'
\set same 'select case when exists ((:old) except (:new)) or exists ((:new) except (:old)) then ''tree differs from the table'' else ''tree = table'' end'

set role authenticated;
:as_dave;
select public.create_page(:'ws', null, 'D: Dave page') ->> 'id' as dave_page \gset
select public.set_page_workspace_role(:'dave_page', 'editor') ->> 'ok' as ignored \gset
select 'a new page is a draft: ' || public.is_draft(p) from public.pages p where p.id = :'dave_page';
select 'dave publishes his page: ' || (public.publish_page(:'dave_page', false) ->> 'published');
select public.set_page_member_role(:'dave_page', :'hank', 'viewer') ->> 'ok' as ignored \gset
reset role;
set role authenticated;
:as_bob;
select public.create_page(:'ws', null, 'D: Secret plan') ->> 'id' as draft \gset
select public.set_page_workspace_role(:'draft', 'commenter') ->> 'ok' as ignored \gset
select public.set_page_group_role(:'draft', :'grp', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'dave', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'erin', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'gwen', 'commenter') ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'draft', 'D: Plan chapter') ->> 'id' as child \gset
select public.create_page(:'ws', :'dave_page', 'D: Bob under Dave') ->> 'id' as under_dave \gset
select public.save_page_content(:'draft', ('[{"id":"m1","type":"paragraph","props":{},"content":['
  || '{"type":"personChip","props":{"userId":"' || :'dave' || '","label":"Dave"}},'
  || '{"type":"personChip","props":{"userId":"' || :'frank' || '","label":"Frank"}}],"children":[]}]')::jsonb, 1) ->> 'ok' as ignored \gset
reset role;
set role authenticated;
:as_dave;
select public.create_page(:'ws', :'draft', 'D: Dave sketch') ->> 'id' as dave_sketch \gset
reset role;

set role authenticated;
:as_bob;
select 'bob (author) reads: ' || (:titles);
select 'bob tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_alice;
select 'alice (workspace owner) reads: ' || (:titles);
select 'alice tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_dave;
select 'dave (invited editor, owns the published parent) reads: ' || (:titles);
select 'dave tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_erin;
select 'erin (invited viewer) reads: ' || (:titles);
select 'erin tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_carol;
select 'carol (admin) reads: ' || (:titles);
select 'carol tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_frank;
select 'frank (unit with access) reads: ' || (:titles);
select 'frank tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_gwen;
select 'gwen (guest, invited) reads: ' || (:titles);
select 'gwen tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_hank;
select 'hank (guest, not invited) reads: ' || (:titles);
select 'hank tree: ' || (:tree) || ' / ' || (:same);
reset role;
select 'notified about the draft: ' || coalesce(string_agg(p.email, ', ' order by p.email), 'nobody') from public.notifications n join public.profiles p on p.id = n.user_id where n.page_id = :'draft';

set role authenticated;
:as_erin;
select 'erin (viewer) publishes: ' || (public.publish_page(:'draft', true)::text);
reset role;
set role authenticated;
:as_gwen;
select 'gwen (guest commenter) publishes: ' || (public.publish_page(:'draft', true)::text);
reset role;
set role authenticated;
:as_carol;
select 'carol (admin) publishes: ' || (public.publish_page(:'draft', true)::text);
reset role;
set role authenticated;
:as_frank;
select 'frank (unit editor) publishes: ' || (public.publish_page(:'draft', true)::text);
reset role;
set role authenticated;
:as_dave;
\set ON_ERROR_STOP 0
select 'dave turns on confirmations on his draft sketch: ' || coalesce(public.set_page_ack(:'dave_sketch', 'read', '{}')::text, 'null');
\set ON_ERROR_STOP 1
reset role;
set role authenticated;
:as_bob;
select 'bob publishes with children: ' || (public.publish_page(:'draft', true) ->> 'published');
reset role;
select 'after publishing: ' || string_agg(title || '=' || (published_at is null)::text, ', ' order by title) from public.pages where title like 'D:%';

set role authenticated;
:as_carol;
select 'carol now reads: ' || (:titles);
select 'carol tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_frank;
select 'frank now reads: ' || (:titles);
select 'frank tree: ' || (:tree) || ' / ' || (:same);
reset role;
set role authenticated;
:as_hank;
select 'hank now reads: ' || (:titles);
select 'hank tree: ' || (:tree) || ' / ' || (:same);
reset role;
select 'notified later: ' || coalesce(string_agg(p.email, ', ' order by p.email), 'nobody') from public.notifications n join public.profiles p on p.id = n.user_id where n.page_id = :'draft';
set role authenticated;
:as_dave;
select 'dave publishes the draft Bob made under his page: ' || (public.publish_page(:'under_dave', false)::text);
reset role;
