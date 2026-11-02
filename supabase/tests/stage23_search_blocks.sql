-- Search by what is on a page: every heading or image (with its text), only on
-- pages the person can open, and narrowed by words.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000023a1', 'alice@kinds.test', now()),
 ('00000000-0000-0000-0000-0000000023b1', 'bob@kinds.test', now()),
 ('00000000-0000-0000-0000-0000000023d1', 'dave@other-kinds.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023a1';
select public.create_workspace('Kinds') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'kinds.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Plan') ->> 'id' as page \gset
select public.save_page_content(:'page', '[
  {"id": "h1", "type": "heading", "props": {"level": 1}, "content": [{"type": "text", "text": "Бюджет 2027", "styles": {}}], "children": []},
  {"id": "p1", "type": "paragraph", "props": {}, "content": [{"type": "text", "text": "Some text", "styles": {}}], "children": [
    {"id": "h2", "type": "heading", "props": {"level": 3}, "content": [{"type": "text", "text": "Нested heading", "styles": {}}], "children": []}
  ]},
  {"id": "i1", "type": "image", "props": {"name": "logo.png", "url": "attachment://x/y/z.webp", "caption": "Новий логотип"}, "children": []},
  {"id": "t1", "type": "table", "props": {}, "content": {"type": "tableContent", "rows": [{"cells": [[{"type": "text", "text": "Q1", "styles": {}}]]}]}, "children": []}
]', 1) ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Private') ->> 'id' as private \gset
select public.save_page_content(:'private', '[{"id": "h9", "type": "heading", "props": {"level": 2}, "content": [{"type": "text", "text": "Salaries", "styles": {}}], "children": []}]', 1) ->> 'ok' as ignored \gset
select public.set_page_workspace_role(:'page', 'viewer') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023d1';
select public.create_workspace('Other kinds') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023a1';
select 'alice, headings: ' || string_agg(title || '#' || block_id || ' ' || block_text, ' | ' order by title, block_id) from public.search_blocks(:'ws', 'heading');
select 'alice, headings with "бюджет": ' || string_agg(block_text, ' | ') from public.search_blocks(:'ws', 'heading', 'бюджет');
select 'alice, images: ' || string_agg(block_id || ' ' || block_text, ' | ') from public.search_blocks(:'ws', 'image');
select 'alice, tables: ' || string_agg(block_id || ' ' || block_text, ' | ') from public.search_blocks(:'ws', 'table');
select 'unknown kind: ' || count(*) from public.search_blocks(:'ws', 'spreadsheet');
select 'under the private page: ' || string_agg(block_text, ' | ') from public.search_blocks(:'ws', 'heading', null, :'private');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023b1';
select 'bob, headings: ' || string_agg(block_text, ' | ' order by block_id) from public.search_blocks(:'ws', 'heading');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000023d1';
select 'dave, headings: ' || count(*) from public.search_blocks(:'ws', 'heading');
set role anon;
\set ON_ERROR_STOP 0
select public.search_blocks(:'ws', 'heading');
\set ON_ERROR_STOP 1
reset role;
delete from public.pages where workspace_id = :'ws';
