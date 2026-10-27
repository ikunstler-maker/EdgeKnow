-- Undo 20261030100000_page_content.sql. Saved content stays in pages.content.
drop function if exists public.save_page_content(uuid, jsonb, integer, boolean);
drop function if exists public.page_content_limit();
