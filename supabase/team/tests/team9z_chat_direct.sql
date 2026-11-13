-- Toker conversations in a team database: only their people see them, not the owner.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select 'bob writes to himself only: ' || (public.chat_open_direct(:'ws', array['00000000-0000-0000-0000-0000000000b1']::uuid[]) ->> 'error');
select public.chat_open_direct(:'ws', array['00000000-0000-0000-0000-0000000000a1']::uuid[]) ->> 'id' as pair \gset
select 'bob writes to alice: ' || (public.chat_post_message(:'pair', 'Hello alice', null, null) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice reads it: ' || (select count(*) from public.chat_messages where channel_id = :'pair' and kind = 'user');
reset role;
