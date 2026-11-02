-- Objects of the services (node space): anyone in the workspace creates;
-- access like pages (owner, admins, workspace, people, groups); saves need the
-- current version; outsiders see and change nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000028a1', 'alice@nodes.test', now()),
 ('00000000-0000-0000-0000-0000000028b1', 'bob@nodes.test', now()),
 ('00000000-0000-0000-0000-0000000028d1', 'dave@nodes.test', now()),
 ('00000000-0000-0000-0000-0000000028c1', 'carol@other-nodes.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select public.create_workspace('Nodes') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'nodes.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028c1';
select public.create_workspace('Other nodes') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Plan', '{"nodes": [{"id": "r", "text": "Launch"}, {"id": "a", "parent": "r", "text": "Design"}]}') as made \gset
select 'bob makes a map: ' || (:'made'::jsonb ->> 'ok');
select (:'made'::jsonb ->> 'id') as map \gset
select 'not a service yet: ' || public.create_service_object(:'ws', 'boards', 'board', 'x', '{}')::text;
select 'unknown kind: ' || public.create_service_object(:'ws', 'nodes', 'pie', 'x', '{}')::text;
select 'title too long: ' || public.create_service_object(:'ws', 'nodes', 'mindmap', repeat('x', 201), '{}')::text;
select 'text for search: ' || search_text from public.service_objects where id = :'map';
select 'save: ' || public.save_service_object(:'map', 'Launch plan', '{"nodes": [{"id": "r", "text": "Launch"}, {"id": "b", "parent": "r", "text": "Budget"}]}', 1)::text;
select 'stale save: ' || public.save_service_object(:'map', null, '{"nodes": []}', 1)::text;
select 'after: ' || title || ' / ' || search_text || ' / v' || version from public.service_objects where id = :'map';

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028d1';
select 'dave (workspace editor) saves: ' || (public.save_service_object(:'map', null, null, 2) ->> 'ok');
select 'dave can''t manage access: ' || public.set_service_object_workspace_role(:'map', null)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select 'bob makes it private: ' || (public.set_service_object_workspace_role(:'map', null) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028d1';
select 'dave sees: ' || count(*) from public.service_objects where id = :'map';
select 'dave saves: ' || public.save_service_object(:'map', 'x', null, 3)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select 'alice (owner of the workspace) sees: ' || count(*) from public.service_objects where id = :'map';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select 'bob gives dave view: ' || (public.set_service_object_member_role(:'map', '00000000-0000-0000-0000-0000000028d1', 'viewer') ->> 'ok');
select 'to an outsider: ' || public.set_service_object_member_role(:'map', '00000000-0000-0000-0000-0000000028c1', 'viewer')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028d1';
select 'dave the viewer sees: ' || count(*) || ', saves: ' || (public.save_service_object(:'map', 'x', null, 3) ->> 'error') || ', trashes: ' || (public.trash_service_object(:'map', false) ->> 'error') from public.service_objects where id = :'map';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select public.create_workspace_group(:'ws', 'Writers') ->> 'id' as grp \gset
select public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000028d1', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select 'bob gives the group edit: ' || (public.set_service_object_group_role(:'map', :'grp', 'editor') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028d1';
select 'dave through the group saves: ' || (public.save_service_object(:'map', 'Group edit', null, 3) ->> 'ok');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028c1';
select 'outsider sees: ' || count(*) from public.service_objects;
select 'outsider sees access: ' || count(*) from public.service_object_access;
select 'outsider makes one in the workspace: ' || public.create_service_object(:'ws', 'nodes', 'mindmap', 'x', '{}')::text;
select 'outsider saves: ' || public.save_service_object(:'map', 'x', null, 4)::text;
select 'outsider trashes: ' || public.trash_service_object(:'map', false)::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select 'alice removes dave: ' || (public.remove_member(:'ws', '00000000-0000-0000-0000-0000000028d1') ->> 'ok');
reset role;
select 'dave''s own access gone: ' || count(*) from public.service_object_access where object_id = :'map';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select 'forever before the bin: ' || public.delete_service_object_forever(:'map')::text;
select 'to the bin: ' || (public.trash_service_object(:'map', false) ->> 'ok');
select 'saving in the bin: ' || public.save_service_object(:'map', 'x', null, 4)::text;
select 'forever: ' || (public.delete_service_object_forever(:'map') ->> 'ok');
reset role;
select 'gone: ' || count(*) from public.service_objects where id = :'map';
select 'direct writes refused: ' || has_table_privilege('authenticated', 'public.service_objects', 'insert') || ' ' || has_table_privilege('authenticated', 'public.service_object_access', 'insert');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028b1';
select public.create_service_object(:'ws', 'nodes', 'flow', 'Flow', '{"nodes": [{"id": "a", "title": "Start", "description": "Begin here"}, {"id": "b", "title": "Done"}], "edges": [{"id": "e", "source": "a", "target": "b", "label": "then"}]}') ->> 'id' as flow \gset
select 'a diagram''s text for search: ' || search_text from public.service_objects where id = :'flow';
reset role;
delete from public.workspaces where name in ('Nodes', 'Other nodes');
