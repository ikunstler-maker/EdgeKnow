-- Vault in a team database: a member's folder and file, seen by the workspace until restricted.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.vault_create_folder(:'ws', null, 'Team folder') ->> 'id' as folder \gset
select public.begin_vault_file(:'ws', :'folder', 'plan.pdf', 'application/pdf', 1000) ->> 'id' as f \gset
select 'a 6 MB file (no storage limit here) goes in parts: ' || (public.begin_vault_file(:'ws', null, 'big.zip', 'application/zip', 6291456) ->> 'large');
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'f';
set role authenticated;
:as_alice;
select 'alice sees: ' || (select string_agg(name, ', ' order by name collate "C") from public.vault_items);
reset role;
set role authenticated;
:as_bob;
select 'bob restricts it: ' || (public.vault_set_general(:'folder', false, null) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice sees: ' || (select count(*) from public.vault_items);
reset role;
