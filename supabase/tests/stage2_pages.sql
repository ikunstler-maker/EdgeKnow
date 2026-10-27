-- Stage 2 security checks for pages, tree moves and the trash.
-- Output is compared with stage2_pages.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000a1', 'alice@team.test', now()),
 ('00000000-0000-0000-0000-0000000000b1', 'bob@team.test', now()),
 ('00000000-0000-0000-0000-0000000000c1', 'carol@blocked.test', now());

-- Alice and Bob share a workspace (Bob joins by domain); Carol is in none.
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.create_workspace('Team') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'team.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- Alice builds a 3-level tree: root > child > grandchild, plus a second root.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.create_page(:'ws', null, 'Root') ->> 'id' as root \gset
select public.create_page(:'ws', :'root', 'Child') ->> 'id' as child \gset
select public.create_page(:'ws', :'child', 'Grandchild') ->> 'id' as grand \gset
select public.create_page(:'ws', null, 'Second') ->> 'id' as second \gset
select 'alice sees pages: ' || count(*) from public.pages;
select 'tree depth ok: ' || ((select parent_id from public.pages where id = :'grand') = :'child');
select 'roots in order: ' || string_agg(title, ',' order by position) from public.pages where parent_id is null;

-- Rename, icon, validation
select 'rename: ' || (public.rename_page(:'child', '  Renamed child  '))::text;
select 'renamed title: ' || title from public.pages where id = :'child';
select 'icon: ' || (public.set_page_icon(:'root', '📘'))::text;
select 'icon too long: ' || (public.set_page_icon(:'root', repeat('x', 17)))::text;
select 'title too long: ' || (public.rename_page(:'root', repeat('x', 201)))::text;

-- Moves: grandchild to top level at index 0, then a cycle attempt.
select 'move to root: ' || (public.move_page(:'grand', null, 0))::text;
select 'roots after move: ' || string_agg(title, ',' order by position) from public.pages where parent_id is null;
select 'move branch: ' || (public.move_page(:'root', :'second', 0))::text;
select 'root parent is second: ' || ((select parent_id from public.pages where id = :'root') = :'second');
select 'cycle: ' || (public.move_page(:'second', :'child', 0))::text;
select 'self parent: ' || (public.move_page(:'second', :'second', 0))::text;

-- Bob (same workspace, no access to Alice's pages) sees and changes nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select 'bob sees pages: ' || count(*) from public.pages;
select 'bob sees by id: ' || count(*) from public.pages where id = :'root';
select 'bob rename: ' || (public.rename_page(:'root', 'hacked'))::text;
select 'bob icon: ' || (public.set_page_icon(:'root', 'x'))::text;
select 'bob child: ' || (public.create_page(:'ws', :'root', 'intruder'))::text;
select 'bob move: ' || (public.move_page(:'root', null, 0))::text;
select 'bob trash: ' || (public.trash_page(:'root'))::text;
select 'bob role: ' || coalesce(public.effective_role(:'root'), 'none');
select 'bob own page: ' || (public.create_page(:'ws', null, 'Bob page') ->> 'ok');
select 'bob sees pages now: ' || count(*) from public.pages;
reset role;

-- Carol is in no workspace: no access at all.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select 'carol create: ' || (public.create_page(:'ws', null, 'x'))::text;
select 'carol sees pages: ' || count(*) from public.pages;
reset role;

-- Direct writes are blocked for everyone.
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into public.pages (owner_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'direct');
update public.pages set title = 'direct';
delete from public.pages;
select public.place_page(:'root', null, 0);
select public.purge_trash();
reset role;
\set ON_ERROR_STOP 1

-- Trash: deleting Second takes its whole subtree (Root > Child) with it.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select 'trash second: ' || (public.trash_page(:'second'))::text;
select 'trashed rows: ' || count(*) from public.pages where deleted_at is not null;
select 'trash roots: ' || string_agg(title, ',') from public.pages where trashed_with = id;
select 'child under trashed: ' || (public.create_page(:'ws', :'child', 'x'))::text;
select 'move into trashed: ' || (public.move_page(:'grand', :'child', 0))::text;
select 'trash twice: ' || (public.trash_page(:'root'))::text;
select 'forever not in trash: ' || (public.delete_page_forever(:'grand'))::text;
select 'restore subpage: ' || (public.restore_page(:'root'))::text;
select 'restore: ' || (public.restore_page(:'second'))::text;
select 'trashed after restore: ' || count(*) from public.pages where deleted_at is not null;

-- A subpage trashed on its own, then its parent trashed; restoring the subpage
-- while the parent is still in the trash brings it back at the top level.
select 'trash child: ' || (public.trash_page(:'child'))::text;
select 'trash second again: ' || (public.trash_page(:'second'))::text;
select 'trash roots: ' || string_agg(title, ',' order by title) from public.pages where trashed_with = id;
select 'restore child alone: ' || (public.restore_page(:'child'))::text;
select 'child now top level: ' || ((select parent_id from public.pages where id = :'child') is null);
select 'child stays live: ' || ((select deleted_at from public.pages where id = :'child') is null);

-- Delete forever removes the page and its subtree.
select 'forever: ' || (public.delete_page_forever(:'second'))::text;
select 'alice pages left: ' || string_agg(title, ',' order by title) from public.pages;
reset role;

-- Auto-purge: only trash roots older than 30 days go.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.trash_page(:'grand') is not null as ignored \gset
select public.trash_page(:'child') is not null as ignored \gset
reset role;
update public.pages set deleted_at = now() - interval '31 days' where id = :'grand';
update public.pages set deleted_at = now() - interval '29 days' where id = :'child';
select 'purged: ' || public.purge_trash();
select 'remaining titles: ' || string_agg(title, ',' order by title) from public.pages;

-- Pages never cross workspaces.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.create_workspace('Other') ->> 'id' as ws2 \gset
select public.create_page(:'ws2', null, 'Elsewhere') ->> 'id' as elsewhere \gset
select 'move across workspaces: ' || (public.move_page(:'elsewhere', :'child', 0))::text;
select 'child in other workspace: ' || (public.create_page(:'ws2', :'child', 'x'))::text;
select 'author recorded: ' || ((select created_by from public.pages where id = :'elsewhere') = auth.uid());
reset role;
\set ON_ERROR_STOP 0
update public.pages set parent_id = :'child' where id = :'elsewhere';
\set ON_ERROR_STOP 1
