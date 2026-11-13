-- VAULT-4: one storage count for every upload (Vault files count everywhere), "Used" by
-- service for the owner and admins only, and a former member's Vault items handed over
-- with their pages.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000090a1', 'alice@vaultstore.test', now()),
 ('00000000-0000-0000-0000-0000000090b1', 'bob@vaultstore.test', now()),
 ('00000000-0000-0000-0000-0000000090c1', 'carol@vaultstore.test', now());
\set alice '00000000-0000-0000-0000-0000000090a1'
\set bob '00000000-0000-0000-0000-0000000090b1'
\set carol '00000000-0000-0000-0000-0000000090c1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Vault store') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'vaultstore.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;

-- Bob keeps 700 KB in Vault (EdgeKnow's storage): a 400 KB wiki picture no longer fits.
set request.jwt.claim.sub = :'bob';
select public.begin_vault_file(:'ws', null, 'big.pdf', 'application/pdf', 716800) ->> 'id' as big \gset
select public.vault_create_folder(:'ws', null, 'Bob''s folder') ->> 'id' as folder \gset
select public.create_page(:'ws', null, 'Bob''s page') ->> 'id' as page \gset
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'big';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'a 400 KB wiki picture: ' || (public.register_attachment(:'page', 'image/png', 409600, 10, 10) ->> 'error')
  || ', a 200 KB one: ' || (public.register_attachment(:'page', 'image/png', 204800, 10, 10) ->> 'ok')
  || ', then a 200 KB Vault file: ' || (public.begin_vault_file(:'ws', null, 'more.pdf', 'application/pdf', 204800) ->> 'error');

-- "Used" by service: the owner sees sizes, a member does not.
select 'bob reads the usage: ' || (public.vault_storage_usage(:'ws') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice: Vault ' || (public.vault_storage_usage(:'ws') -> 'services' -> 'files' ->> 'stored')
  || ', wiki ' || (public.vault_storage_usage(:'ws') -> 'services' -> 'wiki' ->> 'stored');

-- Bob leaves: his page and his Vault items go to Carol with one hand-over.
reset role;
update public.workspace_members set status = 'removed' where workspace_id = :'ws' and user_id = :'bob';
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol lists former owners: ' || (public.departed_page_owners(:'ws') ->> 'error')
  || ', hands them over: ' || (public.reassign_member_pages(:'ws', :'bob', :'carol') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'former owners: ' || (select string_agg((o ->> 'email') || ' ' || (o ->> 'pages') || ' pages ' || (o ->> 'files') || ' files', ', ')
  from jsonb_array_elements(public.departed_page_owners(:'ws') -> 'owners') o);
select 'handed over: ' || (public.reassign_member_pages(:'ws', :'bob', :'carol'))::text;
set request.jwt.claim.sub = :'carol';
select 'carol now owns the folder: ' || public.vault_role(:'folder') || ', may restrict it: ' || (public.vault_set_general(:'folder', false, null) ->> 'ok');
reset role;
