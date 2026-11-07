-- Gallery audio: mp3/m4a/ogg/wav on a page, up to 20 MB into EdgeKnow's storage,
-- 4 MB when the server carries it (Drive); images stay at 2 MB; only page editors.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000042a1', 'alice@gallery.test', now()),
 ('00000000-0000-0000-0000-0000000042e1', 'eve@other-gallery.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000042a1';
select public.create_workspace('Gallery') ->> 'id' as ws \gset
select public.create_page(:'ws', null, 'Media') ->> 'id' as page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000042e1';
select public.create_workspace('Other gallery') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000042a1';
select 'mp3 path: ' || (regexp_replace(public.register_attachment(:'page', 'audio/mpeg', 15000000, 0, 0) ->> 'path', '^.*\.', '.'));
select 'm4a, ogg, wav: ' || concat_ws(', ', public.register_attachment(:'page', 'audio/mp4', 1000, 0, 0) ->> 'ok',
  public.register_attachment(:'page', 'audio/ogg', 1000, 0, 0) ->> 'ok', public.register_attachment(:'page', 'audio/wav', 1000, 0, 0) ->> 'ok');
select 'audio over 20 MB: ' || (public.register_attachment(:'page', 'audio/mpeg', 20971521, 0, 0) ->> 'error');
select 'image over 2 MB: ' || (public.register_attachment(:'page', 'image/png', 3000000, 10, 10) ->> 'error');
select 'other types: ' || (public.register_attachment(:'page', 'audio/flac', 1000, 0, 0) ->> 'error') || ', ' || (public.register_attachment(:'page', 'video/mp4', 1000, 0, 0) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000042e1';
select 'outsider uploads audio: ' || (public.register_attachment(:'page', 'audio/mpeg', 1000, 0, 0) ->> 'error');
reset role;

-- With Google Drive our server carries the bytes: audio up to 4 MB.
insert into public.drive_connections (workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted, connected_by)
values (:'ws', 'team@gallery.test', 'r', 'f', 'b', 'E', '00000000-0000-0000-0000-0000000042a1');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000042a1';
select 'drive: 4 MB ' || (public.register_attachment(:'page', 'audio/mpeg', 4194304, 0, 0) ->> 'backend') || ', more: ' || (public.register_attachment(:'page', 'audio/mpeg', 4194305, 0, 0) ->> 'error');
reset role;

-- Leave nothing for later tests' cleanup counts.
delete from public.attachments where workspace_id = :'ws';
delete from public.attachment_tombstones where storage_path like :'ws' || '/%';
