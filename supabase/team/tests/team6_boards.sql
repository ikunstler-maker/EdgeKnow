-- Boards (step Д1) in a team database: the same rules as centrally.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'boards', 'board', 'Team board', '{"elements": [{"id": "t", "type": "text", "text": "Team note"}]}') ->> 'id' as board \gset
select 'team board text: ' || search_text from public.service_objects where id = :'board';
select 'team board saved: ' || (public.save_service_object(:'board', 'Team board 2', null, 1) ->> 'version');
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees boards: ' || count(*) || ', saves: ' || (public.save_service_object(:'board', 'x', null, 2) ->> 'error') from public.service_objects where service = 'boards';
reset role;
set role authenticated;
:as_bob;
select 'bin and gone: ' || (public.trash_service_object(:'board', false) ->> 'ok') || ' ' || (public.delete_service_object_forever(:'board') ->> 'ok');
reset role;
