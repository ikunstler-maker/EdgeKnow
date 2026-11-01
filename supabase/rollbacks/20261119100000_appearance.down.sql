-- Undo 20261119100000_appearance.sql.
drop function if exists public.set_my_appearance(boolean, text);
alter table public.profiles drop column if exists lure, drop column if exists show_mascot;
