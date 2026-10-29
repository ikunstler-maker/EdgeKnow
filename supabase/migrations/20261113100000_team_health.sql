-- Path C, step 1.5b: how a team's database is doing, from the daily check (and
-- whenever the wiki couldn't reach it). Shown to the team as a banner and in
-- Settings → Database:
--   ok, waking (it was asleep and is being woken up), unreachable, revoked
--   (our key no longer works), almost_full, full.
-- Rollback: supabase/rollbacks/20261113100000_team_health.down.sql

alter table public.team_databases
  add column health text check (health in ('ok', 'waking', 'unreachable', 'revoked', 'almost_full', 'full')),
  add column health_checked_at timestamptz,
  add column database_bytes bigint,
  add column storage_bytes bigint;
