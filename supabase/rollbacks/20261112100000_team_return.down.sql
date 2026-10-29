-- Undo 20261112100000_team_return.sql. A return in progress stops; the
-- workspace stays in its team database (which was never changed).
alter table public.team_databases
  drop column if exists return_report,
  drop column if exists return_progress,
  drop column if exists return_step;
