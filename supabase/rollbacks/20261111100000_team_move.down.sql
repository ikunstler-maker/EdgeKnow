-- Undo 20261111100000_team_move.sql. Moves that are in progress go back to the
-- central database (their registry rows are removed; central data was never
-- touched): the older setup would otherwise finish them without copying.
drop function if exists public.team_move_people(uuid);
delete from public.team_databases t
where t.setup_step in ('copy', 'verify')
   or (t.setup_step <> 'done' and exists (select 1 from public.pages p where p.workspace_id = t.workspace_id));
alter table public.team_databases
  drop column if exists move_report,
  drop column if exists moved_at,
  drop column if exists setup_progress,
  drop constraint team_databases_setup_step_check;
alter table public.team_databases
  add constraint team_databases_setup_step_check
    check (setup_step in ('project', 'schema', 'keys', 'sync', 'sign_in', 'done'));
