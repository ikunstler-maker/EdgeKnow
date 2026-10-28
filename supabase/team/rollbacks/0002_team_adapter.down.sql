-- Undo 0002_team_adapter.sql: removes the team-only parts (sync, guard, settings).
-- The central-only parts the adapter dropped are not brought back — they never
-- belong in a team database; follow with 0001's rollback to remove everything.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator reset pgrst.db_pre_request;
    notify pgrst, 'reload config';
  end if;
end;
$$;
drop function if exists public.edgeknow_guard();
drop function if exists public.team_member_settings();
drop function if exists public.team_sync(jsonb);
drop table if exists public.team_settings;
