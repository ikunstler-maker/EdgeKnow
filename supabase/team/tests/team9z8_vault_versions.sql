-- VAULT-6 in a team database: a new version replaces the file, the old one is kept.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.begin_vault_file(:'ws', null, 'team plan.pdf', 'application/pdf', 1000) ->> 'id' as f \gset
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'f';
set role authenticated;
:as_bob;
select public.begin_vault_version(:'f', 'team plan v2.pdf', 'application/pdf', 3000) ->> 'id' as up \gset
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'up';
set role authenticated;
:as_bob;
select 'version: ' || (public.vault_finish_version(:'up') ->> 'version');
select 'kept: ' || (select count(*) from public.vault_versions where item_id = :'f');
reset role;
