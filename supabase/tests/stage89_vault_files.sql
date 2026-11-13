-- VAULT-2: Vault's own folders and files — seen as on a Drive (everyone in the workspace as
-- viewers by default, restricted items only by the people and units given a role), never
-- by guests or other workspaces; added by members; bin, restore, delete; the admin's limit.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000089a1', 'alice@vault.test', now()),
 ('00000000-0000-0000-0000-0000000089b1', 'bob@vault.test', now()),
 ('00000000-0000-0000-0000-0000000089c1', 'carol@vault.test', now()),
 ('00000000-0000-0000-0000-0000000089d1', 'dave@vault.test', now()),
 ('00000000-0000-0000-0000-0000000089e1', 'gwen@vault.test', now()),
 ('00000000-0000-0000-0000-0000000089f1', 'eve@other-vault.test', now());
\set alice '00000000-0000-0000-0000-0000000089a1'
\set bob '00000000-0000-0000-0000-0000000089b1'
\set carol '00000000-0000-0000-0000-0000000089c1'
\set dave '00000000-0000-0000-0000-0000000089d1'
\set gwen '00000000-0000-0000-0000-0000000089e1'
\set eve '00000000-0000-0000-0000-0000000089f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Vault') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'vault.test') ->> 'ok' as ignored \gset
select public.create_workspace_group(:'ws', 'Design') ->> 'id' as design \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.workspace_members set role = 'guest' where workspace_id = :'ws' and user_id = :'gwen';
insert into public.workspace_group_members (group_id, workspace_id, user_id) values (:'design', :'ws', :'dave');
set role authenticated;

-- Bob adds a folder and a file at the top: the workspace sees them as viewers.
set request.jwt.claim.sub = :'bob';
select public.vault_create_folder(:'ws', null, 'Team') ->> 'id' as team \gset
select public.begin_vault_file(:'ws', :'team', 'plan.pdf', 'application/pdf', 2000) ->> 'id' as plan \gset
select 'a name of spaces: ' || (public.vault_create_folder(:'ws', null, '   ') ->> 'error')
  || ', a file of 0 bytes: ' || (public.begin_vault_file(:'ws', null, 'x', 'text/plain', 0) ->> 'error')
;
select public.begin_vault_file(:'ws', null, 'odd', 'Text/HTML; x', 10) ->> 'id' as odd \gset
select 'an odd kind is kept as bytes: ' || (select mime_type from public.vault_items where id = :'odd');
reset role;
update public.vault_items set storage_backend = 'supabase' where id = :'plan';
set role authenticated;

set request.jwt.claim.sub = :'carol';
select 'carol sees: ' || (select string_agg(name, ', ' order by name) from public.vault_items)
  || '; her role on the file: ' || public.vault_role(:'plan');
select 'carol renames bob''s file: ' || (public.vault_rename(:'plan', 'mine.pdf') ->> 'error')
  || ', adds to his folder: ' || (public.vault_create_folder(:'ws', :'team', 'Sub') ->> 'error')
  || ', trashes it: ' || (public.vault_trash(:'team') ->> 'error')
  || ', shares it: ' || (public.vault_set_member_role(:'team', :'carol', 'editor') ->> 'error');
select 'carol adds at the top: ' || (public.vault_create_folder(:'ws', null, 'Carol''s') ->> 'ok');
select 'the top for carol: ' || (select string_agg(x ->> 'name' || ':' || (x ->> 'role'), ', ') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') x);

set request.jwt.claim.sub = :'gwen';
select 'the guest sees ' || (select count(*) from public.vault_items) || ' items, lists: ' || (public.vault_list(:'ws', null) ->> 'error')
  || ', adds: ' || (public.vault_create_folder(:'ws', null, 'Guest') ->> 'error')
  || ', starts a file: ' || (public.begin_vault_file(:'ws', null, 'g.pdf', 'application/pdf', 10) ->> 'error');
set request.jwt.claim.sub = :'eve';
select 'another workspace sees ' || (select count(*) from public.vault_items) || ' items, lists: ' || (public.vault_list(:'ws', null) ->> 'error')
  || ', adds: ' || (public.vault_create_folder(:'ws', null, 'Eve') ->> 'error')
  || ', reads the sharing: ' || (public.vault_sharing(:'team') ->> 'error');

-- Restricted: only bob, and those he gives a role (carol as an editor, the Design unit as viewers).
set request.jwt.claim.sub = :'bob';
select public.vault_create_folder(:'ws', :'team', 'Inner') ->> 'id' as inner \gset
select 'bob restricts the folder: ' || (public.vault_set_general(:'team', false, null) ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol sees in it: ' || (select count(*) from public.vault_items where id in (:'team', :'plan', :'inner'))
  || ', opens it: ' || (public.vault_list(:'ws', :'team') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'the workspace owner (no role on it) sees: ' || (select count(*) from public.vault_items where id in (:'team', :'plan', :'inner'));
set request.jwt.claim.sub = :'bob';
select 'shares with carol: ' || (public.vault_set_member_role(:'team', :'carol', 'editor') ->> 'ok')
  || ', with the unit: ' || (public.vault_set_group_role(:'team', :'design', 'viewer') ->> 'ok')
  || ', with the guest: ' || (public.vault_set_member_role(:'team', :'gwen', 'viewer') ->> 'error')
  || ', with someone outside: ' || (public.vault_set_member_role(:'team', :'eve', 'viewer') ->> 'error')
  || ', with a unit elsewhere: ' || (public.vault_set_group_role(:'team', (select id from public.workspace_groups where workspace_id = :'other' limit 1), 'viewer') ->> 'error');
select 'the sharing: ' || (select (s ->> 'inherit') || ' ' || coalesce(s ->> 'workspace_role', '-') || ' ' || jsonb_array_length(s -> 'people') || ' ' || jsonb_array_length(s -> 'units')
  from (select public.vault_sharing(:'team') as s) x);
set request.jwt.claim.sub = :'carol';
select 'carol now: ' || public.vault_role(:'team') || ' on the folder, ' || public.vault_role(:'plan') || ' on the file inside'
  || ', renames the file: ' || (public.vault_rename(:'plan', 'Plan v2.pdf') ->> 'ok')
  || ', adds a folder: ' || (public.vault_create_folder(:'ws', :'team', 'Carol inside') ->> 'ok');
set request.jwt.claim.sub = :'dave';
select 'dave (Design) is a ' || public.vault_role(:'plan') || ' of the file, renames it: ' || (public.vault_rename(:'plan', 'x') ->> 'error');

-- Only the inner folder shared with alice: she finds it at the top.
set request.jwt.claim.sub = :'bob';
select 'shares the inner folder with alice: ' || (public.vault_set_member_role(:'inner', :'alice', 'viewer') ->> 'ok');
set request.jwt.claim.sub = :'alice';
select 'alice''s top shows it: ' || (select string_agg(x ->> 'name', ', ' order by x ->> 'name') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') x)
  || '; its path for her: ' || (public.vault_list(:'ws', :'inner') -> 'path')::text;

-- Moving: never into itself or below; only where the person may add.
set request.jwt.claim.sub = :'carol';
select 'into its own folder below: ' || (public.vault_move(:'team', :'inner') ->> 'error')
  || ', the file to the top: ' || (public.vault_move(:'plan', null) ->> 'ok');
select 'at the top it no longer has the folder''s grant: carol is a ' || public.vault_role(:'plan') || ', moves it back: ' || (public.vault_move(:'plan', :'team') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob (its owner) moves it back: ' || (public.vault_move(:'plan', :'team') ->> 'ok');
set request.jwt.claim.sub = :'dave';
select 'dave moves it out: ' || (public.vault_move(:'plan', null) ->> 'error');

-- The admin's limit; and without a Drive, the workspace's storage.
set request.jwt.claim.sub = :'carol';
select 'carol sets a limit: ' || (public.set_vault_file_limit(:'ws', 1) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice sets 1 MB: ' || (public.set_vault_file_limit(:'ws', 1) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select '2 MB then: ' || (public.begin_vault_file(:'ws', null, 'big.zip', 'application/zip', 2097152) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'no limit again: ' || (public.set_vault_file_limit(:'ws', null) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'a 300 MB file goes in parts: ' || (public.begin_vault_file(:'ws', null, 'film.mov', 'video/quicktime', 314572800) ->> 'large');
reset role;
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;
select 'a 2 MB file over the workspace''s storage: ' || (public.begin_vault_file(:'ws', null, 'a.pdf', 'application/pdf', 2097152) ->> 'error');
reset role;
update public.workspaces set storage_limit_mb = 50 where id = :'ws';
set role authenticated;

-- The bin: the folder with everything inside; restore; delete for good (its file's bytes go).
set request.jwt.claim.sub = :'bob';
select 'bob bins the folder: ' || (public.vault_trash(:'team') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol''s top: ' || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') x)
  || '; her bin: ' || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(public.vault_list(:'ws', null, true) -> 'items') x)
  || '; renames inside the bin: ' || (public.vault_rename(:'plan', 'y') ->> 'error')
  || '; restores the file alone: ' || (public.vault_restore(:'plan') ->> 'error');
set request.jwt.claim.sub = :'dave';
select 'dave (viewer) restores: ' || (public.vault_restore(:'team') ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol restores it: ' || (public.vault_restore(:'team') ->> 'ok');
select 'all back: ' || (select count(*) from public.vault_items where deleted_at is not null);
set request.jwt.claim.sub = :'bob';
select 'bins and deletes for good: ' || (public.vault_trash(:'team') ->> 'ok') || ' ' || (public.vault_delete_forever(:'team') ->> 'ok');
reset role;
select 'left of the folder: ' || (select count(*) from public.vault_items where id in (:'team', :'plan', :'inner'))
  || ', the file''s bytes queued for removal: ' || (select count(*) from public.attachment_tombstones where storage_path = :'ws' || '/vault/' || :'plan');

-- The daily cleanup: the bin after 30 days, unfinished uploads after a day.
update public.vault_items set created_at = now() - interval '2 days' where storage_backend = 'pending';
select 'cleaned: ' || public.clean_vault_items();
select 'pending left: ' || (select count(*) from public.vault_items where storage_backend = 'pending');
update public.workspace_members set status = 'removed' where workspace_id = :'ws' and user_id = :'carol';
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol, removed, sees ' || (select count(*) from public.vault_items);
reset role;
