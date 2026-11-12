-- Toker in a team database: an open channel for the workspace, a closed one only for
-- its people, writing only through the functions, signals without text, a stranger sees nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.chat_create_channel(:'ws', null, 'team-general', '', false, null) ->> 'id' as general \gset
select public.chat_create_channel(:'ws', null, 'team-secret', '', true, null) ->> 'id' as secret \gset
select 'bob writes: ' || (public.chat_post_message(:'general', 'Hello team', null, null) ->> 'ok')
  || ', in secret: ' || (public.chat_post_message(:'secret', 'Only me', null, null) ->> 'ok');
insert into public.chat_messages (workspace_id, channel_id, author_id, body) values (:'ws', :'general', '00000000-0000-0000-0000-0000000000b1', 'direct');
reset role;
set role authenticated;
:as_alice;
select 'alice (owner) sees: ' || (select string_agg(name, ', ' order by name) from public.chat_channels)
  || ', reads: ' || (select count(*) from public.chat_messages);
select 'alice deletes secret: ' || (public.chat_delete_channel(:'secret') ->> 'error');
reset role;
set role authenticated;
:as_zed;
select 'zed (not a member) sees: ' || (select count(*) from public.chat_channels) || ', writes: ' || (public.chat_post_message(:'general', 'Hi', null, null) ->> 'error');
reset role;
select 'signals: ' || (select count(*) > 0 from realtime.messages where topic = 'chat:' || :'general')
  || ', with text: ' || (select count(*) from realtime.messages where payload::text like '%Hello%');
