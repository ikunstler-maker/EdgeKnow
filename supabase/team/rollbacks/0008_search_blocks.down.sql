-- Undo the search by block kind.
drop function if exists public.search_blocks(uuid, text, text, uuid, integer);
