-- Page history: versions by editing session (one person's saves within 10 minutes
-- merge), publishing and restoring make their own; only the page's owner and editors
-- read versions or restore them; drafts stay closed; frozen pages and the trash can't
-- be restored; comments whose text goes are marked, not deleted; old versions go and
-- the newest one stays; nobody writes versions directly.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000059a1', 'alice@history.test', now()),
 ('00000000-0000-0000-0000-0000000059b1', 'bob@history.test', now()),
 ('00000000-0000-0000-0000-0000000059c1', 'carol@history.test', now()),
 ('00000000-0000-0000-0000-0000000059d1', 'dave@history.test', now()),
 ('00000000-0000-0000-0000-0000000059e1', 'erin@history.test', now()),
 ('00000000-0000-0000-0000-0000000059f1', 'frank@history.test', now()),
 ('00000000-0000-0000-0000-0000000059a2', 'gwen@client-history.test', now()),
 ('00000000-0000-0000-0000-0000000059b2', 'zed@elsewhere-history.test', now());
\set alice '00000000-0000-0000-0000-0000000059a1'
\set bob '00000000-0000-0000-0000-0000000059b1'
\set carol '00000000-0000-0000-0000-0000000059c1'
\set dave '00000000-0000-0000-0000-0000000059d1'
\set erin '00000000-0000-0000-0000-0000000059e1'
\set frank '00000000-0000-0000-0000-0000000059f1'
\set gwen '00000000-0000-0000-0000-0000000059a2'
\set zed '00000000-0000-0000-0000-0000000059b2'

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('History') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'history.test') ->> 'ok' as ignored \gset
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
set request.jwt.claim.sub = :'zed';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

-- Bob's page: Dave edits, Erin comments, Frank reads (as everyone), Carol is an admin, Gwen a guest.
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.set_member_role(:'ws', :'carol', 'admin') ->> 'ok' as ignored \gset
select public.invite_member(:'ws', 'gwen@client-history.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.create_page(:'ws', null, 'Handbook') ->> 'id' as page \gset
select public.set_page_workspace_role(:'page', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'dave', 'editor') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'erin', 'commenter') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'page', :'gwen', 'viewer') ->> 'ok' as ignored \gset
select 'publish: ' || (public.publish_page(:'page', false) ->> 'published');

\set text_a '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"First text","styles":{}}],"children":[]}]'
\set text_b '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Second text","styles":{}}],"children":[]}]'
\set text_c '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Dave was here","styles":{}}],"children":[]}]'
\set versions 'select coalesce(string_agg(reason || '':'' || coalesce(content #>> ''{0,content,0,text}'', ''-''), '', '' order by created_at, id), ''none'') from public.page_versions where page_id = :''page'''

-- Bob saves twice in one session, then Dave saves.
select 'bob saves: ' || (public.save_page_content(:'page', :'text_a'::jsonb, 1) ->> 'ok');
select 'bob saves again: ' || (public.save_page_content(:'page', :'text_b'::jsonb, 2) ->> 'ok');
set request.jwt.claim.sub = :'dave';
select 'dave saves: ' || (public.save_page_content(:'page', :'text_c'::jsonb, 3) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob sees: ' || (:versions);

-- After a pause of over 10 minutes Bob's next save is a new version.
reset role;
update public.page_versions set last_at = last_at - interval '11 minutes', created_at = created_at - interval '11 minutes' where page_id = :'page';
set role authenticated;
set request.jwt.claim.sub = :'dave';
select 'dave saves after a pause: ' || (public.save_page_content(:'page', :'text_b'::jsonb, 4) ->> 'ok');
select 'dave sees: ' || (:versions);
select 'renaming is a version too: ' || coalesce((public.rename_page(:'page', 'Handbook 2'))::text, 'done');
select 'titles: ' || string_agg(title, ', ' order by created_at, id) from public.page_versions where page_id = :'page';

-- Who reads versions.
set request.jwt.claim.sub = :'alice';
select 'alice (workspace owner, viewer of the page) sees: ' || (:versions);
set request.jwt.claim.sub = :'carol';
select 'carol (admin, viewer) sees: ' || (:versions);
set request.jwt.claim.sub = :'erin';
select 'erin (commenter) sees: ' || (:versions);
set request.jwt.claim.sub = :'frank';
select 'frank (viewer) sees: ' || (:versions);
set request.jwt.claim.sub = :'gwen';
select 'gwen (guest viewer) sees: ' || (:versions);
set request.jwt.claim.sub = :'zed';
select 'zed (another workspace) sees: ' || (:versions);

-- Who restores. The first "Second text" version is what Bob saved.
reset role;
select id as v_bob from public.page_versions where page_id = :'page' and content #>> '{0,content,0,text}' = 'Second text' order by created_at limit 1 \gset
select id as v_first from public.page_versions where page_id = :'page' order by created_at, id limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = :'erin';
select 'erin restores: ' || (public.restore_page_version(:'v_first')::text);
set request.jwt.claim.sub = :'carol';
select 'carol restores: ' || (public.restore_page_version(:'v_first')::text);
set request.jwt.claim.sub = :'zed';
select 'zed restores: ' || (public.restore_page_version(:'v_first')::text);
set request.jwt.claim.sub = :'dave';
select 'dave restores the first version: ' || (public.restore_page_version(:'v_first') ->> 'ok');
reset role;
select 'page now: ' || title || ' / ' || coalesce(content::text, 'empty') || ' / version ' || version from public.pages where id = :'page';
select 'latest version: ' || reason || ', from the first: ' || (restored_from = :'v_first') from public.page_versions where page_id = :'page' order by created_at desc, id desc limit 1;
select 'nothing lost: ' || count(*) filter (where content #>> '{0,content,0,text}' = 'Second text') || ' versions still hold the text before' from public.page_versions where page_id = :'page';

-- Nobody writes versions directly.
set role authenticated;
set request.jwt.claim.sub = :'bob';
\set ON_ERROR_STOP 0
insert into public.page_versions (workspace_id, page_id, reason) values (:'ws', :'page', 'edit');
update public.page_versions set content = null where page_id = :'page';
delete from public.page_versions where page_id = :'page';
\set ON_ERROR_STOP 1
select 'still there: ' || count(*) from public.page_versions where page_id = :'page';

-- Comments: a thread whose text goes away is marked, and comes back with the text.
select public.create_comment_thread(:'page', 'Marked', 'Is this right?', null) ->> 'id' as thread \gset
select public.save_page_content(:'page', ('[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Marked","styles":{"comment":"' || :'thread' || '"}}],"children":[]}]')::jsonb, (select version from public.pages where id = :'page')) ->> 'ok' as ignored \gset
reset role;
select id as v_marked from public.page_versions where page_id = :'page' order by created_at desc, id desc limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'thread before: ' || status from public.comment_threads where id = :'thread';
select 'restore without the text: ' || (public.restore_page_version(:'v_bob') ->> 'ok');
select 'thread: ' || status from public.comment_threads where id = :'thread';
select 'restore with it: ' || (public.restore_page_version(:'v_marked') ->> 'ok');
select 'thread: ' || status from public.comment_threads where id = :'thread';

-- A frozen page and a page in the trash are not restored.
select public.set_page_ack(:'page', 'read', '{}') ->> 'ok' as ignored \gset
select 'restore a frozen page: ' || (public.restore_page_version(:'v_bob')::text);
select public.create_page(:'ws', null, 'Old notes') ->> 'id' as old_page \gset
select public.save_page_content(:'old_page', :'text_a'::jsonb, 1) ->> 'ok' as ignored \gset
reset role;
select id as v_old from public.page_versions where page_id = :'old_page' order by created_at desc limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.trash_page(:'old_page') ->> 'ok' as ignored \gset
select 'restore in the trash: ' || (public.restore_page_version(:'v_old')::text);

-- A draft's history stays closed to those the draft is closed to.
select public.create_page(:'ws', null, 'Draft plan') ->> 'id' as draft \gset
select public.set_page_workspace_role(:'draft', 'editor') ->> 'ok' as ignored \gset
select public.save_page_content(:'draft', :'text_a'::jsonb, 1) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select 'dave (editor of everything, not invited to the draft) sees its versions: ' || count(*) from public.page_versions where page_id = :'draft';
set request.jwt.claim.sub = :'bob';
select 'bob sees his draft''s versions: ' || count(*) from public.page_versions where page_id = :'draft';
select 'publish the draft: ' || (public.publish_page(:'draft', false) ->> 'published');
select 'publishing is a version: ' || reason from public.page_versions where page_id = :'draft' order by created_at desc, id desc limit 1;
set request.jwt.claim.sub = :'dave';
select 'dave sees them once published: ' || count(*) from public.page_versions where page_id = :'draft';
reset role;

-- Old versions go, the newest of each page stays.
update public.page_versions set created_at = now() - interval '30 days' where page_id in (:'page', :'draft');
select 'old versions: ' || count(*) from public.page_versions where page_id in (:'page', :'draft');
select 'pruned: ' || (public.prune_all_page_versions() > 0);
select 'left: ' || string_agg(p.title || '=' || (select count(*) from public.page_versions v where v.page_id = p.id), ', ' order by p.title) from public.pages p where p.id in (:'page', :'draft');
select 'anyone may prune: ' || has_function_privilege('authenticated', 'public.prune_all_page_versions()', 'execute');
