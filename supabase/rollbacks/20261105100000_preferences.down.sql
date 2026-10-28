-- Undo 20261105100000_preferences.sql. Theme and language go back to the defaults.
drop function if exists public.set_my_preferences(text, text);
alter table public.profiles drop column if exists theme, drop column if exists locale;
