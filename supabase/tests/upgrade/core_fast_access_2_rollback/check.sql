-- After CORE-5 and its rollback: the rules are back exactly as CORE-3 left them, the helpers are gone.
\pset format unaligned
\pset tuples_only on
select tablename || ': ' || qual from pg_policies where schemaname = 'public' and cmd = 'SELECT'
  and tablename in ('pages', 'task_comments', 'task_events', 'task_files', 'task_placements', 'task_time_entries', 'task_web_links', 'task_wishlist_links') order by tablename;
select 'helpers gone: ' || not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('my_readable_page_ids', 'task_project_of', 'task_frozen_until_for_me'));
