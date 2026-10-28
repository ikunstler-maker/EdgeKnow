-- Undo 20261110100000_team_connect.sql. Rows still in setup (without keys) go first.
delete from public.team_databases where project_url is null or publishable_key is null or secret_key_encrypted is null;
drop index if exists public.team_databases_project_ref;
alter table public.team_databases
  drop constraint if exists team_databases_ready,
  drop column if exists connected_by,
  drop column if exists setup_step,
  drop column if exists management_token_encrypted,
  drop column if exists project_ref,
  alter column project_url set not null,
  alter column publishable_key set not null,
  alter column secret_key_encrypted set not null;
