-- Undo 20261109100000_team_databases.sql. Team databases themselves are untouched.
drop function if exists public.team_sync_payload(uuid);
drop table if exists public.team_databases;
