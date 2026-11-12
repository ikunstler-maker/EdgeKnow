-- Toker mentions in a team database: a mention reaches the bell of who sees the channel.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''


set role authenticated;
:as_bob;
select public.chat_create_channel(:'ws', null, 'team-mentions', '', false, null) ->> 'id' as ch \gset
select 'bob mentions alice: ' || (public.chat_post_message(:'ch', 'Alice, look', null, array['00000000-0000-0000-0000-0000000000a1']::uuid[]) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice''s bell: ' || (select string_agg((x ->> 'kind') || ' ' || (x -> 'chat' ->> 'excerpt'), ', ') from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' like 'chat_%');
reset role;
