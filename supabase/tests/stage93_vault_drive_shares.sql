-- VAULT-2b: who should have a Drive-kept Vault file on the team's Drive — members with a role
-- in Vault (viewers read, editors write), never guests or former members; server only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000093a1', 'alice@vaultdrive.test', now()),
 ('00000000-0000-0000-0000-0000000093b1', 'bob@vaultdrive.test', now()),
 ('00000000-0000-0000-0000-0000000093c1', 'carol@vaultdrive.test', now()),
 ('00000000-0000-0000-0000-0000000093e1', 'gwen@vaultdrive.test', now());
\set alice '00000000-0000-0000-0000-0000000093a1'
\set bob '00000000-0000-0000-0000-0000000093b1'
\set carol '00000000-0000-0000-0000-0000000093c1'
\set gwen '00000000-0000-0000-0000-0000000093e1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Vault drive') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'vaultdrive.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.workspace_members set role = 'guest' where workspace_id = :'ws' and user_id = :'gwen';
set role authenticated;

set request.jwt.claim.sub = :'bob';
select public.begin_vault_file(:'ws', null, 'deck.pdf', 'application/pdf', 1000) ->> 'id' as deck \gset
select public.begin_vault_file(:'ws', null, 'local.pdf', 'application/pdf', 1000) ->> 'id' as local \gset
select 'a member asks who should have it: ' || (select count(*) from public.vault_drive_wanted(:'ws'));
reset role;
update public.vault_items set storage_backend = 'drive', drive_source = 'wiki', drive_account_id = gen_random_uuid(), drive_file_id = 'drive-deck' where id = :'deck';
update public.vault_items set storage_backend = 'supabase' where id = :'local';
select 'at the top: ' || (select string_agg(split_part(email, '@', 1) || ' ' || role, ', ' order by email) from public.vault_drive_wanted(:'ws'));

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob restricts it: ' || (public.vault_set_general(:'deck', false, null) ->> 'ok')
  || ', gives carol editing: ' || (public.vault_set_member_role(:'deck', :'carol', 'editor') ->> 'ok');
reset role;
select 'restricted: ' || (select string_agg(split_part(email, '@', 1) || ' ' || role, ', ' order by email) from public.vault_drive_wanted(:'ws'));

-- Carol leaves the workspace: no longer wanted on the Drive.
update public.workspace_members set status = 'removed' where workspace_id = :'ws' and user_id = :'carol';
select 'carol gone: ' || (select string_agg(split_part(email, '@', 1) || ' ' || role, ', ' order by email) from public.vault_drive_wanted(:'ws'));
-- In the bin: nobody.
update public.vault_items set deleted_at = now(), trashed_with = id where id = :'deck';
select 'in the bin: ' || (select count(*) from public.vault_drive_wanted(:'ws'));
update public.vault_items set deleted_at = null, trashed_with = null where id = :'deck';

-- What could not be opened on the Drive: for those who edit the file only.
insert into public.vault_drive_shares (item_id, workspace_id, email, role, drive_file_id, error)
values (:'deck', :'ws', 'nogoogle@vaultdrive.test', 'reader', 'drive-deck', 'no Google account');
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'alice (no role on it) reads the failures: ' || (public.vault_drive_failures(:'deck') ->> 'error');
select 'a member reads the table: ' || (select count(*) from public.vault_drive_shares);
set request.jwt.claim.sub = :'bob';
select 'bob: ' || (public.vault_drive_failures(:'deck') -> 'emails')::text;
reset role;
