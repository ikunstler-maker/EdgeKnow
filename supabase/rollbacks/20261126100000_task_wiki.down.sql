-- Undo task mentions on pages (the chips stay in the pages' text).
drop trigger if exists pages_task_links on public.pages;
drop function if exists public.refresh_task_page_links();
drop table if exists public.task_page_links;
