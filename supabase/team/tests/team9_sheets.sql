-- Tables (step Т1) in a team database.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'sheets', 'sheet', 'Team budget', '{"sheets": [{"name": "Main", "celldata": [{"r": 0, "c": 0, "v": {"v": "Team cell", "m": "Team cell"}}]}]}') ->> 'id' as sheet \gset
select 'team table text: ' || search_text from public.service_objects where id = :'sheet';
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member) sees tables: ' || count(*) || ', saves: ' || (public.save_service_object(:'sheet', 'x', null, 1) ->> 'error') from public.service_objects where service = 'sheets';
reset role;
set role authenticated;
:as_bob;
select 'bin and gone: ' || (public.trash_service_object(:'sheet', false) ->> 'ok') || ' ' || (public.delete_service_object_forever(:'sheet') ->> 'ok');
reset role;
