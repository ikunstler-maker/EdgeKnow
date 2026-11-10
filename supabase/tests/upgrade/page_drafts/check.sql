-- After the drafts migration every page that existed is published, at its creation time,
-- and people see exactly what they saw before.
\pset format unaligned
\pset tuples_only on
select 'pages: ' || count(*) || ', drafts: ' || count(*) filter (where published_at is null)
  || ', published at creation: ' || count(*) filter (where published_at = created_at) from public.pages;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000005b1';
select 'member sees: ' || string_agg(title, ',' order by title) from public.pages where deleted_at is null;
select 'member tree: ' || string_agg(title || '/' || draft, ',' order by title) from public.my_page_tree((select id from public.workspaces where name = 'Upgrade drafts'));
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000005a1';
select 'owner sees: ' || string_agg(title, ',' order by title) from public.pages;
reset role;
