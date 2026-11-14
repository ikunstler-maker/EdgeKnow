-- VAULT-6: versions of Vault files — a new version by whoever edits the file (its upload
-- hidden until done), seen by whoever sees the file, restored or deleted by editors.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000092a1', 'alice@vaultver.test', now()),
 ('00000000-0000-0000-0000-0000000092b1', 'bob@vaultver.test', now()),
 ('00000000-0000-0000-0000-0000000092c1', 'carol@vaultver.test', now());
\set alice '00000000-0000-0000-0000-0000000092a1'
\set bob '00000000-0000-0000-0000-0000000092b1'
\set carol '00000000-0000-0000-0000-0000000092c1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Vault versions') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'vaultver.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset

set request.jwt.claim.sub = :'bob';
select public.begin_vault_file(:'ws', null, 'plan.pdf', 'application/pdf', 1000) ->> 'id' as plan \gset
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'plan';
set role authenticated;

-- Carol only views the file: no new version, no restore.
set request.jwt.claim.sub = :'carol';
select 'carol starts a version: ' || (public.begin_vault_version(:'plan', 'p.pdf', 'application/pdf', 10) ->> 'error');

set request.jwt.claim.sub = :'bob';
select public.begin_vault_version(:'plan', 'plan v2.pdf', 'application/pdf', 2000) ->> 'id' as up \gset
select 'finished before its bytes are there: ' || (public.vault_finish_version(:'up') ->> 'error');
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'up';
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol sees the upload: ' || (select count(*) from public.vault_items where id = :'up')
  || ', finishes it: ' || (public.vault_finish_version(:'up') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob lists: ' || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') x)
  || '; finishes: ' || (public.vault_finish_version(:'up') ->> 'version');
select 'the file now: ' || (select name || ' v' || version || ' ' || bytes || ' ' || (storage_path = :'ws' || '/vault/' || :'up') from public.vault_items where id = :'plan')
  || '; the upload row is gone: ' || (select count(*) from public.vault_items where id = :'up');
set request.jwt.claim.sub = :'carol';
select 'carol sees the versions: ' || (select string_agg('v' || version_no || ' ' || bytes, ', ') from public.vault_versions where item_id = :'plan')
  || ', restores: ' || (public.vault_restore_version((select id from public.vault_versions where item_id = :'plan' and version_no = 1)) ->> 'error')
  || ', deletes: ' || (public.vault_delete_version((select id from public.vault_versions where item_id = :'plan' and version_no = 1)) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob restores v1: ' || (public.vault_restore_version((select id from public.vault_versions where item_id = :'plan' and version_no = 1)) ->> 'version');
select 'now ' || (select 'v' || version || ' ' || bytes from public.vault_items where id = :'plan')
  || ', kept: ' || (select string_agg('v' || version_no || ' ' || bytes, ', ' order by version_no) from public.vault_versions where item_id = :'plan');
set request.jwt.claim.sub = :'alice';
select 'the owner sees the space of versions too: ' || (public.vault_storage_usage(:'ws') -> 'services' -> 'files' ->> 'stored');
set request.jwt.claim.sub = :'bob';
select 'bob deletes v2: ' || (public.vault_delete_version((select id from public.vault_versions where item_id = :'plan' and version_no = 2)) ->> 'ok');
reset role;
select 'its bytes queued for removal: ' || (select count(*) from public.attachment_tombstones where storage_path = :'ws' || '/vault/' || :'up');

-- An upload of a version never put in place goes with the daily cleanup.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.begin_vault_version(:'plan', 'v4.pdf', 'application/pdf', 10) ->> 'id' as stale \gset
reset role;
update public.vault_items set storage_backend = 'supabase', created_at = now() - interval '2 days' where id = :'stale';
select 'cleaned: ' || public.clean_vault_items() || ', the file stays: ' || (select count(*) from public.vault_items where id = :'plan');
