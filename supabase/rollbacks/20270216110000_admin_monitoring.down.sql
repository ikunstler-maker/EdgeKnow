-- Rollback of ADMIN-2 monitoring.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('platform-snapshot') where exists (select 1 from cron.job where jobname = 'platform-snapshot');
  end if;
end;
$$;
drop function if exists public.platform_stats_history();
drop function if exists public.platform_workspace_load();
drop function if exists public.platform_take_snapshot();
drop table if exists public.platform_daily_stats;
