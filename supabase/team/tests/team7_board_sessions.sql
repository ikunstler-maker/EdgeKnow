-- Voting and the timer (step Д3a) in a team database.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'boards', 'board', 'Team retro', '{"elements": []}') ->> 'id' as board \gset
select 'team voting: ' || (public.set_board_voting(:'board', 1) ->> 'ok') || ', vote: ' || (public.toggle_board_vote(:'board', 'n1') ->> 'voted');
select 'team tally: ' || (public.board_session(:'board') -> 'tally')::text;
reset role;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || (public.board_session(:'board') ->> 'error') || ' ' || (public.toggle_board_vote(:'board', 'n1') ->> 'error');
reset role;
set role authenticated;
:as_bob;
select 'gone with the board: ' || (public.trash_service_object(:'board', false) ->> 'ok') || ' ' || (public.delete_service_object_forever(:'board') ->> 'ok');
reset role;
select 'nothing left: ' || (select count(*) from public.board_votes) || ' ' || (select count(*) from public.board_sessions);
