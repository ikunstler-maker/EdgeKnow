-- Pictures on boards (step Д3b): editors add them (images only, up to 4 MB, the
-- workspace's limit when stored by EdgeKnow); whoever sees the board sees them;
-- outsiders see nothing; a removed one waits for the daily cleanup.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000032a1', 'alice@pictures.test', now()),
 ('00000000-0000-0000-0000-0000000032b1', 'bob@pictures.test', now()),
 ('00000000-0000-0000-0000-0000000032c1', 'carol@other-pictures.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032a1';
select public.create_workspace('Pictures') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'pictures.test') ->> 'ok' as ignored \gset
select public.create_service_object(:'ws', 'boards', 'board', 'Mood', '{"elements": []}') ->> 'id' as board \gset
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map', '{}') ->> 'id' as map \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032c1';
select public.create_workspace('Other pictures') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032b1';
select public.register_object_file(:'board', 'photo.png', 'image/png', 1000) as made \gset
select 'bob adds a picture: ' || (:'made'::jsonb ->> 'ok') || ', path: ' || ((:'made'::jsonb ->> 'path') like :'ws' || '/objects/' || :'board' || '/%');
select (:'made'::jsonb ->> 'id') as file \gset
select 'not a picture: ' || public.register_object_file(:'board', 'doc.pdf', 'application/pdf', 1000)::text;
select 'too big: ' || public.register_object_file(:'board', 'big.png', 'image/png', 5000000)::text;
select 'not on a map: ' || public.register_object_file(:'map', 'x.png', 'image/png', 10)::text;
select 'bob sees it: ' || count(*) from public.object_files where id = :'file';
reset role;
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;
select 'over the workspace''s limit: ' || public.register_object_file(:'board', 'more.png', 'image/png', 1048000)::text;
reset role;
update public.service_objects set workspace_role = 'viewer' where id = :'board';
set role authenticated;
select 'a viewer sees it: ' || count(*) from public.object_files where id = :'file';
select 'a viewer doesn''t add: ' || public.register_object_file(:'board', 'x.png', 'image/png', 10)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032c1';
select 'outsider sees: ' || count(*) from public.object_files;
select 'outsider adds: ' || public.register_object_file(:'board', 'x.png', 'image/png', 10)::text;
reset role;
select 'direct writes refused: ' || has_table_privilege('authenticated', 'public.object_files', 'insert') || ' ' || has_table_privilege('authenticated', 'public.object_files', 'update');
delete from public.service_objects where id = :'board';
select 'deleted with the board, then cleaned up: ' || (select count(*) from public.object_files where id = :'file') || ' ' || (select count(*) from public.attachment_tombstones where storage_path like '%/' || :'file');
delete from public.attachment_tombstones where storage_path like :'ws' || '/%';
delete from public.workspaces where name in ('Pictures', 'Other pictures');
delete from auth.users where email in ('alice@pictures.test', 'bob@pictures.test', 'carol@other-pictures.test');
