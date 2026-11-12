-- Toker search and later sending in a team database.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.chat_create_channel(:'ws', null, 'team-later', '', false, null) ->> 'id' as ch \gset
select public.chat_post_message(:'ch', 'Quarterly roadmap', null, null) ->> 'id' as ignored \gset
select 'bob finds: ' || jsonb_array_length(public.chat_search(:'ws', 'roadmap'));
select public.chat_schedule_message(:'ch', 'Later hello', null, null, now() + interval '1 hour') ->> 'id' as later \gset
reset role;
update public.chat_scheduled set send_at = now() - interval '1 minute' where id = :'later';
set role authenticated;
:as_alice;
select 'alice''s page sends it: ' || public.chat_send_due(:'ws');
select 'she reads it: ' || (select count(*) from public.chat_messages where body = 'Later hello');
reset role;
