-- Page cover checks: kinds, validation (no CSS or markup gets through), rights, clean-up.
-- Output is compared with stage8_cover.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000008a1', 'alice@cover.test', now()),
 ('00000000-0000-0000-0000-0000000008b1', 'bob@cover.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select public.create_workspace('Cover') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'cover.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'With cover') ->> 'id' as page \gset
select public.create_page(:'ws', null, 'Other') ->> 'id' as other \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select 'colour: ' || (public.set_page_cover(:'page', '{"type":"color","color":"#FFAA00","extra":"x"}') -> 'cover')::text;
select 'gradient: ' || (public.set_page_cover(:'page', '{"type":"gradient","kind":"radial","angle":450,"stops":[{"color":"#000000","at":80},{"color":"#ffffff","at":-5},{"color":"#123456","at":40.6}]}') -> 'cover')::text;
select 'link image: ' || (public.set_page_cover(:'page', '{"type":"image","url":"https://example.com/a.jpg","y":130}') -> 'cover')::text;
select 'css in colour: ' || (public.set_page_cover(:'page', '{"type":"color","color":"red;background:url(x)"}'))::text;
select 'one stop: ' || (public.set_page_cover(:'page', '{"type":"gradient","stops":[{"color":"#000000","at":0}]}'))::text;
select 'five stops: ' || (public.set_page_cover(:'page', '{"type":"gradient","stops":[{"color":"#000000","at":0},{"color":"#000000","at":1},{"color":"#000000","at":2},{"color":"#000000","at":3},{"color":"#000000","at":4}]}'))::text;
select 'http image: ' || (public.set_page_cover(:'page', '{"type":"image","url":"http://example.com/a.jpg"}'))::text;
select 'quote in url: ' || (public.set_page_cover(:'page', '{"type":"image","url":"https://x.com/a\") ;x"}'))::text;
select 'javascript: ' || (public.set_page_cover(:'page', '{"type":"image","url":"javascript:alert(1)"}'))::text;
select 'unknown kind: ' || (public.set_page_cover(:'page', '{"type":"video","url":"https://x.com"}'))::text;
select 'still link image: ' || (cover ->> 'url') from public.pages where id = :'page';

-- Uploaded covers: only a file registered for this same page.
select public.register_attachment(:'page', 'image/webp', 1000, 1920, 600) ->> 'path' as path \gset
select public.register_attachment(:'other', 'image/webp', 1000, 1920, 600) ->> 'path' as other_path \gset
select 'own upload: ' || (public.set_page_cover(:'page', jsonb_build_object('type', 'image', 'url', 'ek-attachment:' || :'path')) ->> 'ok');
select 'other page''s file: ' || (public.set_page_cover(:'page', jsonb_build_object('type', 'image', 'url', 'ek-attachment:' || :'other_path')))::text;
select 'made-up file: ' || (public.set_page_cover(:'page', jsonb_build_object('type', 'image', 'url', 'ek-attachment:' || :'ws' || '/' || :'page' || '/x.webp')))::text;

-- Bob has no role on the page; then a viewer still can't change it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select 'no access: ' || (public.set_page_cover(:'page', null))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select public.set_page_member_role(:'page', '00000000-0000-0000-0000-0000000008b1', 'viewer') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008b1';
select 'viewer: ' || (public.set_page_cover(:'page', null))::text;
select 'viewer reads cover: ' || (cover ->> 'type') from public.pages where id = :'page';
reset role;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
update public.pages set cover = '{"type":"color","color":"red"}' where id = :'page';
reset role;
\set ON_ERROR_STOP 1

-- The cover image is kept by the daily clean-up; the unused one goes.
update public.attachments set created_at = now() - interval '2 days';
select 'collected: ' || public.collect_unreferenced_attachments();
select 'cover file kept: ' || count(*) from public.attachments where storage_path = :'path';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000008a1';
select 'remove: ' || (public.set_page_cover(:'page', null))::text;
reset role;
