-- Undo 20261108100000_profile_stats.sql. Pages are untouched; only the counts go.
drop function if exists public.profile_stats(uuid, uuid);
drop function if exists public.set_my_profile_visibility(uuid, text);
alter table public.workspace_members drop column if exists profile_visibility;
drop trigger if exists pages_contributions on public.pages;
drop function if exists public.record_page_contribution();
drop table if exists public.page_contributions;
