-- Boards (step Д3a): voting on sticky notes (N votes each, editors start and
-- close it) and a shared timer; only through the functions, only with access.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000031a1', 'alice@votes.test', now()),
 ('00000000-0000-0000-0000-0000000031b1', 'bob@votes.test', now()),
 ('00000000-0000-0000-0000-0000000031c1', 'carol@other-votes.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';
select public.create_workspace('Votes') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'votes.test') ->> 'ok' as ignored \gset
select public.create_service_object(:'ws', 'boards', 'board', 'Retro', '{"elements": []}') ->> 'id' as board \gset
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Map', '{}') ->> 'id' as map \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031c1';
select public.create_workspace('Other votes') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031b1';
select 'voting closed: ' || public.toggle_board_vote(:'board', 's1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';
select 'alice opens voting, 2 each: ' || (public.set_board_voting(:'board', 2) ->> 'ok');
select 'too many each: ' || public.set_board_voting(:'board', 50)::text;
select 'not on a map: ' || public.set_board_voting(:'map', 2)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031b1';
select 'bob votes s1: ' || (public.toggle_board_vote(:'board', 's1') ->> 'voted');
select 'bob votes s2: ' || (public.toggle_board_vote(:'board', 's2') ->> 'voted');
select 'bob''s third vote: ' || public.toggle_board_vote(:'board', 's3')::text;
select 'bob takes s2 back: ' || (public.toggle_board_vote(:'board', 's2') ->> 'voted');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';
select 'alice votes s1: ' || (public.toggle_board_vote(:'board', 's1') ->> 'voted');
select 'alice sees: ' || (public.board_session(:'board') - 'now' - 'timer_ends_at')::text;
select 'alice starts a 5-minute timer: ' || (public.set_board_timer(:'board', 300) ->> 'ok');
select 'it ends in about 5 minutes: ' || (((public.board_session(:'board') ->> 'timer_ends_at')::timestamptz - now()) between interval '299 seconds' and interval '301 seconds');
select 'a timer too long: ' || public.set_board_timer(:'board', 99999)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031b1';
select 'bob sees the timer: ' || ((public.board_session(:'board') ->> 'timer_seconds') = '300');
reset role;
update public.service_objects set workspace_role = 'viewer' where id = :'board';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031b1';
select 'a viewer doesn''t vote: ' || public.toggle_board_vote(:'board', 's4')::text;
select 'nor starts the timer: ' || public.set_board_timer(:'board', 60)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031c1';
select 'outsider reads: ' || public.board_session(:'board')::text;
select 'outsider votes: ' || public.toggle_board_vote(:'board', 's1')::text;
select 'outsider times: ' || public.set_board_timer(:'board', 60)::text;
select 'outsider may read the tables: ' || has_table_privilege('public.board_votes', 'select') || ' ' || has_table_privilege('public.board_sessions', 'select');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';
select 'a new voting: ' || (public.set_board_voting(:'board', 3) ->> 'ok');
select '…clears the old votes: ' || (public.board_session(:'board') -> 'tally')::text;
select 'closing: ' || (public.set_board_voting(:'board', null) ->> 'ok');
select '…keeps the number: ' || (public.board_session(:'board') ->> 'votes_per_person') || ' ' || (public.board_session(:'board') ->> 'voting_open');
select 'stop the timer: ' || (public.set_board_timer(:'board', null) ->> 'ok');
select '…stopped: ' || coalesce(public.board_session(:'board') ->> 'timer_ends_at', 'yes');
reset role;
select 'direct writes refused: ' || has_table_privilege('authenticated', 'public.board_votes', 'insert') || ' ' || has_table_privilege('authenticated', 'public.board_sessions', 'update');
delete from public.workspaces where name in ('Votes', 'Other votes');
delete from auth.users where email in ('alice@votes.test', 'bob@votes.test', 'carol@other-votes.test');
