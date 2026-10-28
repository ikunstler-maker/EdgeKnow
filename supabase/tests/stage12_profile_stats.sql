-- Profile statistics: counted at every save, private by default, shown to the
-- workspace only by the person's own choice, never across workspaces.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000012a1', 'alice@stats.test', now()),
 ('00000000-0000-0000-0000-0000000012b1', 'bob@stats.test', now()),
 ('00000000-0000-0000-0000-0000000012e1', 'eve@other-stats.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012a1';
select public.create_workspace('Stats') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'stats.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'First') ->> 'id' as page1 \gset
select public.create_page(:'ws', null, 'Second') ->> 'id' as page2 \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012e1';
select public.create_workspace('Other stats') ->> 'id' as other_ws \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012a1';
-- 10 characters, then 4 more, then 6 removed.
select public.save_page_content(:'page1', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Hello Word","styles":{}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
select public.save_page_content(:'page1', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Hello World!!!","styles":{}}],"children":[]}]', 2) ->> 'ok' as ignored \gset
select public.save_page_content(:'page1', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Hello World!!!","styles":{}}],"children":[]}]', 3) ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page2', '00000000-0000-0000-0000-0000000012b1', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page1', '00000000-0000-0000-0000-0000000012b1', 'viewer') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012b1';
select public.save_page_content(:'page2', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Bob was here","styles":{}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
select public.save_page_content(:'page2', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Bob","styles":{}}],"children":[]}]', 2) ->> 'ok' as ignored \gset

-- Own statistics.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012a1';
select 'alice own: ' || (s - 'name' - 'joined_at')::text from public.profile_stats(:'ws', '00000000-0000-0000-0000-0000000012a1') s;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012b1';
select 'bob own: ' || (s - 'name' - 'joined_at')::text from public.profile_stats(:'ws', '00000000-0000-0000-0000-0000000012b1') s;

-- Private by default: Bob can't see Alice.
select 'bob sees private alice: ' || public.profile_stats(:'ws', '00000000-0000-0000-0000-0000000012a1')::text;
-- Alice shows hers to the workspace.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012a1';
select 'alice shows: ' || public.set_my_profile_visibility(:'ws', 'workspace')::text;
select 'bad value: ' || public.set_my_profile_visibility(:'ws', 'everyone')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012b1';
select 'bob sees shown alice: ' || (public.profile_stats(:'ws', '00000000-0000-0000-0000-0000000012a1') ->> 'pages_created');
-- Eve is in another workspace: nothing, even though the profile is shown.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012e1';
select 'eve sees alice: ' || public.profile_stats(:'ws', '00000000-0000-0000-0000-0000000012a1')::text;
select 'eve sets visibility there: ' || public.set_my_profile_visibility(:'ws', 'workspace')::text;
select 'eve asks for alice in her own workspace: ' || public.profile_stats(:'other_ws', '00000000-0000-0000-0000-0000000012a1')::text;
select 'eve reads contributions: ' || count(*) from public.page_contributions;
reset role;

-- No direct access to the table, not even to one's own rows.
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000012a1';
select count(*) from public.page_contributions;
insert into public.page_contributions (workspace_id, page_id, user_id, chars_added) values (:'ws', :'page1', '00000000-0000-0000-0000-0000000012a1', 1000000);
update public.workspace_members set profile_visibility = 'workspace' where user_id = '00000000-0000-0000-0000-0000000012b1';
reset role;
\set ON_ERROR_STOP 1
select 'bob still private: ' || profile_visibility from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000012b1';
