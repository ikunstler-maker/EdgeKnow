-- Google Drive storage: the token is never readable by users, the quota stops
-- applying once Drive is connected, status is for owner/admins only, and
-- deleted files remember where they lived.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-00000000d0a1', 'alice@drive.test', now()),
 ('00000000-0000-0000-0000-00000000d0b1', 'bob@drive.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0a1';
select public.create_workspace('Drive') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'drive.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Files') ->> 'id' as page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
update public.workspaces set storage_limit_mb = 1 where id = :'ws';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0a1';
select 'before drive: ' || (public.register_attachment(:'page', 'image/webp', 900000, 10, 10) ->> 'backend');
select 'quota on supabase: ' || (public.register_attachment(:'page', 'image/webp', 900000, 10, 10))::text;
select 'status: ' || (s - 'drive' - 'supabase_bytes')::text || ', drive ' || coalesce((s -> 'drive')::text, 'none') from public.workspace_storage_status(:'ws') s;
reset role;

-- The server connects Drive (with the secret key, as table owner here).
insert into public.drive_connections (workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted, connected_by)
values (:'ws', 'team@drive.test', 'root1', 'files1', 'backups1', 'ENCRYPTED', '00000000-0000-0000-0000-00000000d0a1')
returning id as conn \gset

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0a1';
select 'with drive: ' || (public.register_attachment(:'page', 'image/webp', 900000, 10, 10) ->> 'backend');
select 'drive status: ' || (s -> 'drive' ->> 'account_email') || ', to move ' || (s ->> 'to_move') || ', token shown: ' || ((s -> 'drive') ? 'token_encrypted') from public.workspace_storage_status(:'ws') s;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0b1';
select 'member status: ' || (public.workspace_storage_status(:'ws'))::text;
reset role;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000d0a1';
select token_encrypted from public.drive_connections;
update public.attachments set storage_backend = 'drive';
insert into public.drive_connections (workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted) values (:'ws', 'x', 'x', 'x', 'x', 'x');
select * from public.page_backups;
reset role;
\set ON_ERROR_STOP 1

-- Only one active connection per workspace.
\set ON_ERROR_STOP 0
insert into public.drive_connections (workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted) values (:'ws', 'second@drive.test', 'r2', 'f2', 'b2', 'E');
\set ON_ERROR_STOP 1

-- A file moved to Drive, then deleted: the tombstone keeps its Drive id.
update public.attachments set storage_backend = 'drive', drive_connection_id = :'conn', drive_file_id = 'gfile1'
where id = (select id from public.attachments where page_id = :'page' order by created_at limit 1);
delete from public.attachments where drive_file_id = 'gfile1';
select 'tombstone: ' || storage_backend || ' ' || drive_file_id || ' ' || (drive_connection_id = :'conn') from public.attachment_tombstones where drive_file_id = 'gfile1';
