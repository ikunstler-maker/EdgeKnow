-- Boards (step Д1): an object of the service "boards" (kind "board"); anyone in
-- the workspace makes one, a guest doesn't; access and versions as for maps;
-- search reads its texts and frame names; outsiders see nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000030a1', 'alice@boards.test', now()),
 ('00000000-0000-0000-0000-0000000030b1', 'bob@boards.test', now()),
 ('00000000-0000-0000-0000-0000000030c1', 'carol@other-boards.test', now()),
 ('00000000-0000-0000-0000-0000000030e1', 'gwen@client-boards.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030a1';
select public.create_workspace('Boards') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'boards.test') ->> 'ok' as ignored \gset
select public.invite_member(:'ws', 'gwen@client-boards.test', 'guest', null) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030c1';
select public.create_workspace('Other boards') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030b1';
select public.create_service_object(:'ws', 'boards', 'board', 'Retro', '{"elements": [{"id": "s1", "type": "rectangle", "isDeleted": false}, {"id": "t1", "type": "text", "text": "Went well", "isDeleted": false}, {"id": "t2", "type": "text", "text": "Removed note", "isDeleted": true}, {"id": "f1", "type": "frame", "name": "Sprint 12", "isDeleted": false}]}') as made \gset
select 'bob makes a board: ' || (:'made'::jsonb ->> 'ok');
select (:'made'::jsonb ->> 'id') as board \gset
select 'a board of another kind: ' || public.create_service_object(:'ws', 'boards', 'mindmap', 'x', '{}')::text;
select 'a map is still a map: ' || (public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map', '{}') ->> 'ok');
select 'text for search (deleted text left out): ' || search_text from public.service_objects where id = :'board';
select 'save: ' || (public.save_service_object(:'board', 'Retro 12', '{"elements": [{"id": "t1", "type": "text", "text": "Went better", "isDeleted": false}]}', 1) ->> 'version');
select 'stale save: ' || public.save_service_object(:'board', null, '{"elements": []}', 1)::text;
select 'after: ' || title || ' / ' || search_text from public.service_objects where id = :'board';

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030e1';
select 'the guest sees boards: ' || count(*) from public.service_objects where service = 'boards';
select 'the guest makes a board: ' || (public.create_service_object(:'ws', 'boards', 'board', 'Guest board', '{}') ->> 'ok');
reset role;
select '…the workspace owner owns it: ' || pr.email from public.service_objects o join public.profiles pr on pr.id = o.owner_id where o.title = 'Guest board';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030e1';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030b1';
select 'bob shares it with the guest: ' || (public.set_service_object_member_role(:'board', '00000000-0000-0000-0000-0000000030e1', 'editor') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030e1';
select 'now she edits it: ' || (public.save_service_object(:'board', null, '{"elements": []}', 2) ->> 'ok');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030c1';
select 'outsider sees: ' || count(*) from public.service_objects;
select 'outsider makes one in the workspace: ' || public.create_service_object(:'ws', 'boards', 'board', 'x', '{}')::text;
select 'outsider saves: ' || public.save_service_object(:'board', 'x', null, 3)::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030b1';
select 'to the bin: ' || (public.trash_service_object(:'board', false) ->> 'ok');
select 'forever: ' || (public.delete_service_object_forever(:'board') ->> 'ok');
reset role;
delete from public.workspaces where name in ('Boards', 'Other boards');
delete from auth.users where email in ('alice@boards.test', 'bob@boards.test', 'carol@other-boards.test', 'gwen@client-boards.test');
