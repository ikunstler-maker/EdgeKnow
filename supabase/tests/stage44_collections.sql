-- Sidebar collections: shared per workspace, members (not guests) manage them, one
-- object in several collections without copies, entries only of objects one may open.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000044a1', 'alice@coll.test', now()),
 ('00000000-0000-0000-0000-0000000044b1', 'bob@coll.test', now()),
 ('00000000-0000-0000-0000-0000000044c1', 'gwen@guest-coll.test', now()),
 ('00000000-0000-0000-0000-0000000044d1', 'dave@other-coll.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044a1';
select public.create_workspace('Collections') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'coll.test') ->> 'ok' as ignored \gset
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map one', '{}') ->> 'id' as m1 \gset
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map two', '{}') ->> 'id' as m2 \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044d1';
select public.create_workspace('Other') ->> 'id' as other \gset
reset role;
insert into public.workspace_members (workspace_id, user_id, role, status, joined_via)
values (:'ws', '00000000-0000-0000-0000-0000000044c1', 'guest', 'active', 'invite');
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044a1';
select public.save_object_collection(:'ws', null, 'nodes', 'Category A', null) ->> 'id' as ca \gset
select public.save_object_collection(:'ws', null, 'nodes', 'Category B', null) ->> 'id' as cb \gset
select 'bad service: ' || public.save_object_collection(:'ws', null, 'pages', 'X', null)::text;
select 'empty name: ' || public.save_object_collection(:'ws', null, 'nodes', '  ', null)::text;
select 'm1 in A: ' || (public.set_collection_item(:'ca', :'m1', true) ->> 'ok');
select 'm1 in B: ' || (public.set_collection_item(:'cb', :'m1', true) ->> 'ok');
select 'm1 in A again: ' || (public.set_collection_item(:'ca', :'m1', true) ->> 'ok');
select 'entries of m1: ' || count(*) from public.object_collection_items where object_id = :'m1';
select 'objects stay one: ' || count(*) from public.service_objects where workspace_id = :'ws';
select 'other workspace object: ' || public.set_collection_item(:'ca', gen_random_uuid(), true)::text;

-- Bob (member) sees the collections and their entries, and manages collections.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044b1';
select 'bob sees collections: ' || count(*) from public.object_collections where workspace_id = :'ws';
select 'bob renames: ' || (public.save_object_collection(:'ws', :'cb', null, 'Category B2', 5) ->> 'ok');
select 'bob sees entries: ' || count(*) from public.object_collection_items where workspace_id = :'ws';

-- Gwen (guest) sees collections but cannot change them.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044c1';
select 'guest sees collections: ' || count(*) from public.object_collections where workspace_id = :'ws';
select 'guest makes: ' || public.save_object_collection(:'ws', null, 'nodes', 'Mine', null)::text;
select 'guest deletes: ' || public.delete_object_collection(:'ca')::text;
select 'guest adds: ' || public.set_collection_item(:'ca', :'m2', true)::text;

-- Dave (another workspace) sees nothing and changes nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044d1';
select 'outsider sees collections: ' || count(*) from public.object_collections where workspace_id = :'ws';
select 'outsider sees entries: ' || count(*) from public.object_collection_items where workspace_id = :'ws';
select 'outsider makes: ' || public.save_object_collection(:'ws', null, 'nodes', 'Spy', null)::text;
select 'outsider deletes: ' || public.delete_object_collection(:'ca')::text;
\set ON_ERROR_STOP 0
insert into public.object_collections (workspace_id, service, name) values (:'ws', 'nodes', 'direct');
\set ON_ERROR_STOP 1

-- Alice removes m1 from A; deleting B keeps the map.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000044a1';
select 'm1 out of A: ' || (public.set_collection_item(:'ca', :'m1', false) ->> 'ok');
select 'delete B: ' || (public.delete_object_collection(:'cb') ->> 'ok');
select 'entries left: ' || count(*) from public.object_collection_items where workspace_id = :'ws';
select 'maps left: ' || count(*) from public.service_objects where workspace_id = :'ws';
reset role;
