-- Undo 20270102100000_page_history: page versions, their trigger and functions.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune-page-versions');
  end if;
end;
$$;
drop trigger pages_history on public.pages;
drop function public.track_page_version();
drop function public.restore_page_version(uuid);
drop function public.record_page_version(public.pages, text, uuid);
drop function public.prune_all_page_versions();
drop function public.prune_page_versions(uuid);
drop function public.page_history_session();
drop function public.page_history_days();
drop table public.page_versions;
