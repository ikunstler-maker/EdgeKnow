-- Stage 3 checks for saving page content: versions, conflicts, rights, workspaces, trash, size.
-- Output is compared with stage3_content.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000003a1', 'alice@content.test', now(), '{"full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000003b1', 'bob@content.test', now(), '{}'),
 ('00000000-0000-0000-0000-0000000003c1', 'carol@elsewhere.test', now(), '{}');

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003a1';
select public.create_workspace('Content') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'content.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Doc') ->> 'id' as doc \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003c1';
select public.create_workspace('Elsewhere') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003a1';
select 'initial version: ' || version || ', content null: ' || (content is null) from public.pages where id = :'doc';
select 'save v1: ' || (public.save_page_content(:'doc', '[{"type":"paragraph","content":"Hello"}]', 1))::text;
select 'stored: ' || (content -> 0 ->> 'content') || ', version ' || version from public.pages where id = :'doc';
-- A second tab still on version 1 tries to save: conflict, with who and when.
select 'stale save: ' || (public.save_page_content(:'doc', '[{"type":"paragraph","content":"Other"}]', 1) - 'updated_at')::text;
select 'content kept: ' || (content -> 0 ->> 'content') from public.pages where id = :'doc';
select 'overwrite: ' || (public.save_page_content(:'doc', '[{"type":"paragraph","content":"Mine"}]', 1, true))::text;
select 'after overwrite: ' || (content -> 0 ->> 'content') || ', version ' || version from public.pages where id = :'doc';
select 'not an array: ' || (public.save_page_content(:'doc', '{"type":"paragraph"}', 3))::text;
select 'too large: ' || (public.save_page_content(:'doc', jsonb_build_array(repeat('x', 1000001)), 3))::text;
select 'updated by: ' || (updated_by = auth.uid()) from public.pages where id = :'doc';

-- Bob shares the workspace but has no role on Alice's page; Carol is in another workspace.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003b1';
select 'bob saves: ' || (public.save_page_content(:'doc', '[]', 3))::text;
select 'bob forces: ' || (public.save_page_content(:'doc', '[]', 3, true))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003c1';
select 'carol saves: ' || (public.save_page_content(:'doc', '[]', 3, true))::text;
reset role;

-- Pages in the trash are read-only.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000003a1';
select public.trash_page(:'doc') ->> 'ok' as ignored \gset
select 'save trashed: ' || (public.save_page_content(:'doc', '[]', 3))::text;
reset role;
select 'final: ' || (content -> 0 ->> 'content') || ', version ' || version from public.pages where id = :'doc';

\set ON_ERROR_STOP 0
set role anon;
select public.save_page_content(:'doc', '[]', 3);
reset role;
set role authenticated;
select public.page_content_limit();
reset role;
\set ON_ERROR_STOP 1
