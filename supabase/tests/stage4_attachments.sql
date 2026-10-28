-- Stage 4 checks for images: registering uploads, storage policies, quota, clean-up.
-- Output is compared with stage4_attachments.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000004a1', 'alice@files.test', now()),
 ('00000000-0000-0000-0000-0000000004b1', 'bob@files.test', now()),
 ('00000000-0000-0000-0000-0000000004c1', 'carol@other-files.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select public.create_workspace('Files') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'files.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'With images') ->> 'id' as page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004c1';
select public.create_workspace('Other files') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select public.register_attachment(:'page', 'image/webp', 300000, 1920, 1080) ->> 'path' as path \gset
select 'path in workspace folder: ' || (:'path' like :'ws' || '/' || :'page' || '/%.webp');
select 'svg refused: ' || (public.register_attachment(:'page', 'image/svg+xml', 1000, 10, 10))::text;
select 'too big: ' || (public.register_attachment(:'page', 'image/png', 2097153, 10, 10))::text;
insert into storage.objects (bucket_id, name, owner) values ('attachments', :'path', auth.uid());
select 'alice uploaded registered path: ' || count(*) from storage.objects where name = :'path';
reset role;
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
insert into storage.objects (bucket_id, name, owner) values ('attachments', :'ws' || '/' || :'page' || '/made-up.webp', auth.uid());
insert into public.attachments (workspace_id, page_id, storage_path, mime_type, bytes) values (:'ws', :'page', 'x', 'image/png', 1);
reset role;
\set ON_ERROR_STOP 1

-- Bob is in the workspace without a role on the page; Carol is elsewhere.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
select 'bob registers: ' || (public.register_attachment(:'page', 'image/webp', 1000, 10, 10))::text;
select 'bob sees file: ' || count(*) from storage.objects where name = :'path';
select 'bob sees record: ' || count(*) from public.attachments;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004c1';
select 'carol registers: ' || (public.register_attachment(:'page', 'image/webp', 1000, 10, 10))::text;
select 'carol sees file: ' || count(*) from storage.objects where name = :'path';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select 'alice sees file: ' || count(*) from storage.objects where name = :'path';
reset role;
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004b1';
insert into storage.objects (bucket_id, name, owner) values ('attachments', :'path' || '.copy', auth.uid());
reset role;
\set ON_ERROR_STOP 1

-- Quota per workspace.
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select 'within quota: ' || (public.register_attachment(:'page', 'image/jpeg', 700000, 10, 10) ->> 'ok');
select 'over quota: ' || (public.register_attachment(:'page', 'image/jpeg', 100000, 10, 10))::text;
reset role;

-- Clean-up: unreferenced records older than a day go; their paths are kept for file deletion.
update public.attachments set created_at = now() - interval '2 days' where page_id = :'page';
update public.pages set content = jsonb_build_array(jsonb_build_object('type', 'image', 'props', jsonb_build_object('url', 'ek-attachment:' || :'path'))) where id = :'page';
select 'collected: ' || public.collect_unreferenced_attachments();
select 'kept referenced: ' || count(*) from public.attachments where storage_path = :'path';
select 'tombstones: ' || count(*) from public.attachment_tombstones;
delete from public.pages where id = :'page';
select 'page deleted -> tombstones: ' || count(*) from public.attachment_tombstones;

\set ON_ERROR_STOP 0
set role authenticated;
select public.collect_unreferenced_attachments();
select count(*) from public.attachment_tombstones;
reset role;
\set ON_ERROR_STOP 1
