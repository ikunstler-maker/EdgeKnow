-- After the drafts migration and its rollback: no trace of drafts, the same pages and access.
\pset format unaligned
\pset tuples_only on
select 'published_at gone: ' || not exists (select 1 from information_schema.columns where table_name = 'pages' and column_name = 'published_at');
select 'functions gone: ' || not exists (select 1 from pg_proc where proname in ('publish_page', 'page_draft_open', 'is_draft', 'guard_draft_ack'));
select 'pages kept: ' || count(*) from public.pages;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000005b1';
select 'member sees: ' || string_agg(title, ',' order by title) from public.pages where deleted_at is null;
select 'member tree: ' || string_agg(title, ',' order by title) from public.my_page_tree((select id from public.workspaces where name = 'Upgrade drafts'));
select 'create works: ' || (public.create_page((select id from public.workspaces where name = 'Upgrade drafts'), null, 'After rollback') ->> 'ok');
reset role;
