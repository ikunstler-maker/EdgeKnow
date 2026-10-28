-- Undo 20261103100000_search.sql. Nothing is lost: the search text is rebuilt
-- from the pages when the migration is applied again.
drop function if exists public.search_pages(uuid, text, uuid, integer);
drop function if exists public.search_query(text);
drop trigger if exists pages_search on public.pages;
drop function if exists public.update_page_search();
drop index if exists public.pages_search_idx;
alter table public.pages drop column if exists search_vector, drop column if exists search_text;
drop function if exists public.page_plain_text(jsonb);
