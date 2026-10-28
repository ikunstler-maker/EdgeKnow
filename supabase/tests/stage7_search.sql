-- Search checks: matching, prefixes, rights, scope and depth, trash, other workspaces.
-- Output is compared with stage7_search.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000007a1', 'alice@search.test', now(), '{"full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000007b1', 'bob@search.test', now(), '{"full_name":"Bob"}'),
 ('00000000-0000-0000-0000-0000000007e1', 'eve@other-search.test', now(), '{"full_name":"Eve"}');

\set alice '00000000-0000-0000-0000-0000000007a1'
\set bob '00000000-0000-0000-0000-0000000007b1'
\set eve '00000000-0000-0000-0000-0000000007e1'

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Search') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'search.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Дизайн-система') ->> 'id' as top \gset
select public.create_page(:'ws', :'top', 'Кольори') ->> 'id' as child \gset
select public.create_page(:'ws', :'child', 'Відтінки') ->> 'id' as grand \gset
select public.create_page(:'ws', null, 'Приватні нотатки') ->> 'id' as private \gset
select public.save_page_content(:'child', '[{"id":"c1","type":"paragraph","props":{},"content":[{"type":"text","text":"Основна палітра для дизайнерів <b>bold</b>","styles":{}}],"children":[]},
  {"id":"c2","type":"diagram","props":{"height":480,"data":"{\"nodes\":[{\"id\":\"n1\",\"title\":\"Макет банера\",\"description\":\"Етап погодження\"}],\"edges\":[]}"},"children":[]},
  {"id":"c3","type":"linkCard","props":{"url":"https://example.com","title":"Гайдлайн бренду","description":""},"children":[]}]', 1) ->> 'ok' as ignored \gset
select public.save_page_content(:'grand', '[{"id":"g1","type":"paragraph","props":{},"content":[{"type":"text","text":"Палітра відтінків","styles":{}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
select public.save_page_content(:'private', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Секретна палітра","styles":{}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Other search') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'title: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'дизайн');
select 'prefix in text: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'палітр');
select 'two words: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'палітра відтінків');
select 'diagram node: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'банер');
select 'link card: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'гайдлайн');
select 'snippet: ' || replace(replace(snippet, chr(1), '['), chr(2), ']') from public.search_pages(:'ws', 'основна');
select 'punctuation only: ' || count(*) from public.search_pages(:'ws', '!!! ...');
select 'injection: ' || count(*) from public.search_pages(:'ws', $$'):* | ' & !$$);

-- Scope and depth.
select 'workspace depth 0: ' || coalesce(string_agg(title, ', ' order by title), '-') from public.search_pages(:'ws', 'палітр', null, 0);
select 'workspace depth 1: ' || coalesce(string_agg(title, ', ' order by title), '-') from public.search_pages(:'ws', 'палітр', null, 1);
select 'branch all: ' || string_agg(title || '@' || depth, ', ' order by title) from public.search_pages(:'ws', 'палітр', :'top', null);
select 'branch depth 1: ' || coalesce(string_agg(title, ', ' order by title), '-') from public.search_pages(:'ws', 'палітр', :'top', 1);
select 'branch only itself: ' || coalesce(string_agg(title, ', ' order by title), '-') from public.search_pages(:'ws', 'палітр', :'grand', 0);

-- Bob sees only what is shared with him: the child branch, not the private page.
set request.jwt.claim.sub = :'alice';
select public.set_page_member_role(:'child', :'bob', 'viewer') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select 'bob finds: ' || string_agg(title, ', ' order by title) from public.search_pages(:'ws', 'палітр');
select 'bob in a branch he can''t open: ' || count(*) from public.search_pages(:'ws', 'палітр', :'top', null);
select 'bob private: ' || count(*) from public.search_pages(:'ws', 'секретна');

-- Another workspace finds nothing, even with the right workspace id.
set request.jwt.claim.sub = :'eve';
select 'eve: ' || count(*) from public.search_pages(:'ws', 'палітр');

-- Trashed pages drop out.
set request.jwt.claim.sub = :'alice';
select public.trash_page(:'private') ->> 'ok' as ignored \gset
select 'after trash: ' || count(*) from public.search_pages(:'ws', 'секретна');
reset role;
