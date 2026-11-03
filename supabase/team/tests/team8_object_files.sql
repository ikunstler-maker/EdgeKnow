-- Pictures on boards (step Д3b) in a team database.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'boards', 'board', 'Team mood', '{"elements": []}') ->> 'id' as board \gset
select 'team picture: ' || (public.register_object_file(:'board', 'photo.webp', 'image/webp', 2000) ->> 'ok');
select 'bob sees: ' || count(*) from public.object_files;
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || (select count(*) from public.object_files) || ' ' || (public.register_object_file(:'board', 'x.png', 'image/png', 10) ->> 'error');
reset role;
delete from public.service_objects where id = :'board';
select 'gone with the board: ' || (select count(*) from public.object_files) || ', waits for the cleanup: ' || (select count(*) from public.attachment_tombstones where storage_path like '%/objects/%');
delete from public.attachment_tombstones where storage_path like '%/objects/%';
