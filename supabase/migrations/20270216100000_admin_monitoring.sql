-- ADMIN-2: monitoring for the platform admin — every workspace's load (members, files in
-- EdgeKnow's storage against its limit, last activity) and a daily snapshot of the central
-- project's database and storage, for the trend and the forecast. Numbers only: no names of
-- workspaces the admin isn't in, no titles, no contents. Owner approved 2026-11-14.

-- One row a day: the central project's totals.
create table public.platform_daily_stats (
  day             date primary key,
  database_bytes  bigint not null check (database_bytes >= 0),
  storage_bytes   bigint not null check (storage_bytes >= 0),
  workspaces      integer not null check (workspaces >= 0),
  members         integer not null check (members >= 0),
  files_bytes     bigint not null check (files_bytes >= 0),
  taken_at        timestamptz not null default now()
);
alter table public.platform_daily_stats enable row level security;
create policy "platform admin reads daily stats" on public.platform_daily_stats
  for select to authenticated using (public.is_platform_admin());
revoke all on public.platform_daily_stats from public, anon, authenticated;
grant select on public.platform_daily_stats to authenticated;

-- Takes (or retakes) today's snapshot. Run daily by pg_cron; the server's daily job may call
-- it too (service role). Nobody else may.
create function public.platform_take_snapshot()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_daily_stats (day, database_bytes, storage_bytes, workspaces, members, files_bytes, taken_at)
  values (
    current_date,
    pg_database_size(current_database()),
    coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0),
    (select count(*) from public.workspaces),
    (select count(*) from public.workspace_members m where m.status = 'active'),
    (select coalesce(sum(public.workspace_storage_used(w.id)), 0) from public.workspaces w),
    now()
  )
  on conflict (day) do update set
    database_bytes = excluded.database_bytes,
    storage_bytes = excluded.storage_bytes,
    workspaces = excluded.workspaces,
    members = excluded.members,
    files_bytes = excluded.files_bytes,
    taken_at = excluded.taken_at;
$$;
revoke execute on function public.platform_take_snapshot() from public, anon, authenticated;
grant execute on function public.platform_take_snapshot() to service_role;

-- Every workspace's load for the platform admin. The name only of workspaces she is in.
create function public.platform_workspace_load()
returns table (
  id uuid, short_id text, name text, members bigint, files_bytes bigint, storage_limit_mb integer,
  last_activity timestamptz, data_location text, frozen boolean, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    return;
  end if;
  return query
    select
      w.id, w.short_id,
      case when exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid() and m.status = 'active') then w.name end,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
      public.workspace_storage_used(w.id),
      w.storage_limit_mb,
      greatest(
        (select max(p.updated_at) from public.pages p where p.workspace_id = w.id),
        (select max(t.updated_at) from public.tasks t where t.workspace_id = w.id),
        (select max(o.updated_at) from public.service_objects o where o.workspace_id = w.id),
        (select max(c.created_at) from public.chat_messages c where c.workspace_id = w.id)
      ),
      (select case when t.setup_step is null or t.setup_step = 'done' then 'team' else 'setup' end
       from public.team_databases t where t.workspace_id = w.id),
      w.frozen_at is not null,
      w.created_at
    from public.workspaces w
    order by w.created_at;
end;
$$;
revoke execute on function public.platform_workspace_load() from public, anon;
grant execute on function public.platform_workspace_load() to authenticated;

-- The trend: the last 90 days of snapshots.
create function public.platform_stats_history()
returns setof public.platform_daily_stats
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.platform_daily_stats s
  where public.is_platform_admin() and s.day > current_date - 90
  order by s.day;
$$;
revoke execute on function public.platform_stats_history() from public, anon;
grant execute on function public.platform_stats_history() to authenticated;

-- Daily at 05:23; pg_cron exists on Supabase, plain Postgres (CI tests) skips this.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('platform-snapshot', '23 5 * * *', 'select public.platform_take_snapshot()');
  end if;
end;
$$;
