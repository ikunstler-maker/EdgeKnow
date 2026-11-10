-- After the history migration nothing is copied at once; the first change keeps the
-- text as it was before it, then the change itself.
\pset format unaligned
\pset tuples_only on
select 'versions right after: ' || count(*) from public.page_versions;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000058a1';
select 'edit: ' || (public.save_page_content((select id from public.pages where title = 'Old page'), '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Written after","styles":{}}],"children":[]}]', 2) ->> 'ok');
select 'versions: ' || string_agg(content #>> '{0,content,0,text}', ' -> ' order by created_at) from public.page_versions;
reset role;
