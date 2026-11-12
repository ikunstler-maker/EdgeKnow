-- Toker publishing channels in a team database: only chosen people publish, others comment.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_alice;
select public.chat_create_channel(:'ws', null, 'team-news', '', false, null) ->> 'id' as ch \gset
select 'alice: only chosen publish: ' || (public.chat_set_post_policy(:'ch', 'chosen') ->> 'ok');
select public.chat_post_message(:'ch', 'News', null, null) ->> 'id' as post \gset
reset role;
set role authenticated;
:as_bob;
select 'bob publishes: ' || (public.chat_post_message(:'ch', 'Mine', null, null) ->> 'error')
  || ', comments: ' || (public.chat_post_message(:'ch', 'Nice', :'post', null) ->> 'ok');
reset role;
