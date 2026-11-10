-- After the history migration and its rollback: no trace, the page and saving as before.
\pset format unaligned
\pset tuples_only on
select 'table gone: ' || (to_regclass('public.page_versions') is null);
select 'functions gone: ' || not exists (select 1 from pg_proc where proname in ('restore_page_version', 'record_page_version', 'track_page_version', 'prune_all_page_versions'));
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000058a1';
select 'page kept: ' || (content #>> '{0,content,0,text}') from public.pages where title = 'Old page';
select 'saving works: ' || (public.save_page_content((select id from public.pages where title = 'Old page'), '[]', 2) ->> 'ok');
reset role;
