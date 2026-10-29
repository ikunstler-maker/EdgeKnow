-- Undo 20261113100000_team_health.sql (only check results are lost).
alter table public.team_databases
  drop column if exists storage_bytes,
  drop column if exists database_bytes,
  drop column if exists health_checked_at,
  drop column if exists health;
