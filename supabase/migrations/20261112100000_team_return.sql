-- Path C, step 1.7c: moving a workspace back from its team's database to the
-- central one. While return_step is set the workspace is read from the team
-- database and refuses changes; "copy" brings everything back in portions
-- (progress in return_progress), "verify" compares it all, and only then the
-- registry row goes and the workspace is central again. The team database is
-- only read.
-- Rollback: supabase/rollbacks/20261112100000_team_return.down.sql

alter table public.team_databases
  add column return_step text check (return_step in ('copy', 'verify')),
  add column return_progress jsonb,
  add column return_report jsonb;
