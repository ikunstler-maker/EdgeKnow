-- VAULT-2b in a team database: the Drive's wanted sharing is for the server only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.begin_vault_file(:'ws', null, 'team deck.pdf', 'application/pdf', 1000) ->> 'id' as f \gset
select 'bob asks: ' || (select count(*) from public.vault_drive_wanted(:'ws'));
reset role;
update public.vault_items set storage_backend = 'drive', drive_source = 'wiki', drive_account_id = gen_random_uuid(), drive_file_id = 'drive-team' where id = :'f';
select 'wanted: ' || (select count(*) from public.vault_drive_wanted(:'ws')) || ', bob writes: ' || (select count(*) from public.vault_drive_wanted(:'ws') w where w.email = 'bob@team.test' and w.role = 'writer');
