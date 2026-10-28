-- Undo 20261107100000_page_mentions.sql. Mentions in the text stay; only the list goes.
drop trigger if exists pages_mentions on public.pages;
drop function if exists public.refresh_page_mentions();
drop table if exists public.page_mentions;
