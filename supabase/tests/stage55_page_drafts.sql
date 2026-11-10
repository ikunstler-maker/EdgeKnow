-- Wiki drafts: a new page is a draft seen only by its owner, people invited to it
-- personally and the workspace owner (an invitation to a draft covers the drafts under
-- it). Admins, units, "whole workspace" access, the owner of a published parent and
-- outsiders see nothing — not in the page list, the tree, search, chips' sources,
-- comments or notifications. Publishing (owner or editor) opens the page by the usual
-- rules; existing pages stay published.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000055a1', 'alice@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055b1', 'bob@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055c1', 'carol@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055d1', 'dave@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055e1', 'erin@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055f1', 'frank@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055a2', 'gwen@client-drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055b2', 'hank@client-drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055c2', 'ivan@drafts.test', now()),
 ('00000000-0000-0000-0000-0000000055d2', 'zed@elsewhere-drafts.test', now());
\set alice '00000000-0000-0000-0000-0000000055a1'
\set bob '00000000-0000-0000-0000-0000000055b1'
\set carol '00000000-0000-0000-0000-0000000055c1'
\set dave '00000000-0000-0000-0000-0000000055d1'
\set erin '00000000-0000-0000-0000-0000000055e1'
\set frank '00000000-0000-0000-0000-0000000055f1'
\set gwen '00000000-0000-0000-0000-0000000055a2'
\set hank '00000000-0000-0000-0000-0000000055b2'
\set ivan '00000000-0000-0000-0000-0000000055c2'
\set zed '00000000-0000-0000-0000-0000000055d2'

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Drafts') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'drafts.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'erin';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'frank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'ivan';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'zed';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

-- Alice owns the workspace; Carol is an admin; Frank is in the unit Design, Ivan leads
-- the unit above it; Gwen and Hank are guests.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.set_member_role(:'ws', :'carol', 'admin') ->> 'ok' as ignored \gset
select public.invite_member(:'ws', 'gwen@client-drafts.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
select public.invite_member(:'ws', 'hank@client-drafts.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
select public.create_workspace_group(:'ws', 'Product') ->> 'id' as product \gset
select public.create_workspace_group(:'ws', 'Design', :'product') ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'design', :'frank', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'product', :'ivan', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'product', :'ivan', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Dave's published page, open to everyone (as pages were before drafts).
set request.jwt.claim.sub = :'dave';
select public.create_page(:'ws', null, 'Dave page') ->> 'id' as dave_page \gset
select public.set_page_workspace_role(:'dave_page', 'editor') ->> 'ok' as ignored \gset
select 'a new page is a draft: ' || public.is_draft(p) from public.pages p where p.id = :'dave_page';
select 'dave publishes his page: ' || (public.publish_page(:'dave_page', false)::text);
select 'published again changes nothing: ' || (public.publish_page(:'dave_page', false)::text);
select public.set_page_member_role(:'dave_page', :'hank', 'viewer') ->> 'ok' as ignored \gset

-- Bob's draft, with every kind of access that a published page could have
-- (the whole workspace may comment, the unit Design may edit).
set request.jwt.claim.sub = :'bob';
select public.create_page(:'ws', null, 'Secret plan') ->> 'id' as draft \gset
select public.set_page_workspace_role(:'draft', 'commenter') ->> 'ok' as ignored \gset
select public.set_page_group_role(:'draft', :'design', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'dave', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'erin', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'draft', :'gwen', 'commenter') ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'draft', 'Plan chapter') ->> 'id' as child \gset
select public.create_page(:'ws', :'draft', 'Plan appendix') ->> 'id' as child_pub \gset
select 'a page under a draft, published alone: ' || (public.publish_page(:'child_pub', false) ->> 'published');
-- Bob's draft under Dave's published page: Dave owns the parent, not the draft.
select public.create_page(:'ws', :'dave_page', 'Bob under Dave') ->> 'id' as under_dave \gset
-- Dave (invited editor) adds his own draft under Bob's draft.
set request.jwt.claim.sub = :'dave';
select public.create_page(:'ws', :'draft', 'Dave sketch') ->> 'id' as dave_sketch \gset
-- A published page that mentions the draft by a chip (only its id is stored).
select public.save_page_content(:'dave_page', ('[{"id":"c1","type":"paragraph","props":{},"content":[{"type":"pageChip","props":{"pageId":"' || :'draft' || '"}}],"children":[]}]')::jsonb, 1) ->> 'ok' as ignored \gset
-- Bob mentions Dave (invited) and Frank (not invited) in the draft.
set request.jwt.claim.sub = :'bob';
select public.save_page_content(:'draft', ('[{"id":"m1","type":"paragraph","props":{},"content":[{"type":"text","text":"Secret words","styles":{}},'
  || '{"type":"personChip","props":{"userId":"' || :'dave' || '","label":"Dave"}},'
  || '{"type":"personChip","props":{"userId":"' || :'frank' || '","label":"Frank"}}],"children":[]}]')::jsonb, 1) ->> 'ok' as ignored \gset
reset role;
select 'tree marks: ' || string_agg(title || '=' || (published_at is null)::text, ', ' order by title) from public.pages where workspace_id = :'ws';

-- What each person can see, before publishing.
\set titles 'select coalesce(string_agg(title, '', '' order by title), ''nothing'') from public.pages where workspace_id = :''ws'''
\set tree 'select coalesce(string_agg(title || case when draft then ''*'' else '''' end, '', '' order by title), ''nothing'') from public.my_page_tree(:''ws'')'
\set old 'select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, public.my_role(p) as my_role, public.shared_with_workspace(p) as shared_with_workspace, p.ack_label, public.is_draft(p) as draft from public.pages p where p.workspace_id = :''ws'' and p.deleted_at is null'
\set new 'select * from public.my_page_tree(:''ws'')'
\set same 'select case when exists ((:old) except (:new)) or exists ((:new) except (:old)) then ''tree differs from the table'' else ''tree = table'' end'
\set found 'select coalesce(string_agg(title, '', '' order by title), ''nothing'') from public.search_pages(:''ws'', ''secret'')'
\set notes 'select count(*) from public.notifications where page_id = :''draft'' and user_id = auth.uid()'

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob (author) reads: ' || (:titles);
select 'bob tree: ' || (:tree) || ' / ' || (:same);
select 'bob search: ' || (:found);
set request.jwt.claim.sub = :'alice';
select 'alice (workspace owner) reads: ' || (:titles);
select 'alice tree: ' || (:tree) || ' / ' || (:same);
set request.jwt.claim.sub = :'dave';
select 'dave (invited editor, owns the published parent) reads: ' || (:titles);
select 'dave tree: ' || (:tree) || ' / ' || (:same);
select 'dave notified about the draft: ' || (:notes);
set request.jwt.claim.sub = :'erin';
select 'erin (invited viewer) reads: ' || (:titles);
select 'erin tree: ' || (:tree) || ' / ' || (:same);
set request.jwt.claim.sub = :'carol';
select 'carol (admin) reads: ' || (:titles);
select 'carol tree: ' || (:tree) || ' / ' || (:same);
select 'carol search: ' || (:found);
select 'carol role on the draft: ' || coalesce(public.effective_role(:'draft'), 'none');
select 'carol sharing of the draft: ' || (public.page_sharing(:'draft')::text);
set request.jwt.claim.sub = :'frank';
select 'frank (unit with access) reads: ' || (:titles);
select 'frank tree: ' || (:tree) || ' / ' || (:same);
select 'frank notified about the draft: ' || (:notes);
select 'frank comments on the draft: ' || (public.create_comment_thread(:'draft', 'Secret', 'hi', '{}')::text);
set request.jwt.claim.sub = :'ivan';
select 'ivan (leads the unit above) reads: ' || (:titles);
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest, invited) reads: ' || (:titles);
select 'gwen tree: ' || (:tree) || ' / ' || (:same);
set request.jwt.claim.sub = :'hank';
select 'hank (guest, not invited) reads: ' || (:titles);
select 'hank tree: ' || (:tree) || ' / ' || (:same);
set request.jwt.claim.sub = :'zed';
select 'zed (another workspace) reads: ' || (:titles);
select 'zed tree: ' || (:tree);
reset role;
select 'draft title in readers'' notifications: ' || count(*) from public.notifications where page_id = :'draft' and user_id not in (:'bob', :'dave');

-- An invitation covers only that draft: Erin sees the chapter once invited to it too.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob invites erin to the chapter: ' || (public.set_page_member_role(:'child', :'erin', 'viewer') ->> 'ok');
set request.jwt.claim.sub = :'erin';
select 'erin now reads: ' || (:titles);
select 'erin tree: ' || (:tree) || ' / ' || (:same);
reset role;

-- Who may publish.
set role authenticated;
set request.jwt.claim.sub = :'erin';
select 'erin (viewer) publishes: ' || (public.publish_page(:'draft', true)::text);
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest commenter) publishes: ' || (public.publish_page(:'draft', true)::text);
set request.jwt.claim.sub = :'carol';
select 'carol (admin) publishes: ' || (public.publish_page(:'draft', true)::text);
set request.jwt.claim.sub = :'frank';
select 'frank (unit editor) publishes: ' || (public.publish_page(:'draft', true)::text);
set request.jwt.claim.sub = :'zed';
select 'zed publishes: ' || (public.publish_page(:'draft', true)::text);
set request.jwt.claim.sub = :'dave';
select 'dave turns on confirmations on his draft sketch: ' || coalesce(public.set_page_ack(:'dave_sketch', 'read', '{}')::text, 'null');
reset role;
select 'nothing was published by them: ' || string_agg(title || '=' || (published_at is null)::text, ', ' order by title) from public.pages where id in (:'draft', :'child', :'dave_sketch');

-- Bob publishes with the drafts under it: his own chapter goes too, Dave's sketch
-- (a draft Bob can't open) stays a draft.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob publishes with children: ' || (public.publish_page(:'draft', true) ->> 'published');
reset role;
select 'after publishing: ' || string_agg(title || '=' || (published_at is null)::text, ', ' order by title) from public.pages where workspace_id = :'ws';

set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol (admin) now reads: ' || (:titles);
select 'carol tree: ' || (:tree) || ' / ' || (:same);
set request.jwt.claim.sub = :'frank';
select 'frank now reads: ' || (:titles);
select 'frank search: ' || (:found);
select 'frank notified later: ' || (:notes);
set request.jwt.claim.sub = :'ivan';
select 'ivan now reads: ' || (:titles);
set request.jwt.claim.sub = :'hank';
select 'hank now reads: ' || (:titles);
set request.jwt.claim.sub = :'zed';
select 'zed now reads: ' || (:titles);
set request.jwt.claim.sub = :'dave';
select 'dave now reads: ' || (:titles);
select 'dave publishes his sketch: ' || (public.publish_page(:'dave_sketch', false) ->> 'published');
select 'dave publishes the draft Bob made under his page: ' || (public.publish_page(:'under_dave', false)::text);

reset role;
