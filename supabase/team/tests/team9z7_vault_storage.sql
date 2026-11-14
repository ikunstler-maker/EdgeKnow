-- VAULT-4 in a team database: "Used" by service for the owner and admins only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_alice;
select 'alice: ' || coalesce(public.vault_storage_usage(:'ws') ->> 'ok', public.vault_storage_usage(:'ws') ->> 'error');
reset role;
set role authenticated;
:as_bob;
select 'bob: ' || coalesce(public.vault_storage_usage(:'ws') ->> 'ok', public.vault_storage_usage(:'ws') ->> 'error');
reset role;
