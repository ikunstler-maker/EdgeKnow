-- Toker files in a team database: registered and sent by who writes, seen by the channel.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.chat_create_channel(:'ws', null, 'team-files', '', false, null) ->> 'id' as ch \gset
select public.register_chat_file(:'ch', 'plan.pdf', 'application/pdf', 1000, 'file', null, null, null) ->> 'id' as f \gset
reset role;
update public.chat_files set storage_backend = 'supabase' where id = :'f';
set role authenticated;
:as_bob;
select 'bob sends it: ' || (public.chat_post_message(:'ch', 'The plan', null, null, array[:'f']::uuid[]) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice sees: ' || (select string_agg(name, ', ') from public.chat_files);
reset role;
