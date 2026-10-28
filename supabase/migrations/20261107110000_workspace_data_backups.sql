-- Daily snapshot of a workspace's own data (members, access, comments, page tree,
-- file list, recent log) to its Google Drive, next to the page backups. The last
-- 14 snapshots are kept; older ones are deleted from the Drive.
-- Rollback: supabase/rollbacks/20261107110000_workspace_data_backups.down.sql

create table public.workspace_data_backups (
  id                  uuid primary key default gen_random_uuid(),
  drive_connection_id uuid not null references public.drive_connections (id) on delete cascade,
  drive_file_id       text not null,
  created_at          timestamptz not null default now()
);
create index workspace_data_backups_conn_idx on public.workspace_data_backups (drive_connection_id, created_at desc);

alter table public.workspace_data_backups enable row level security;
-- No policies: only the server (secret key) uses this table.
revoke all on public.workspace_data_backups from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.workspace_data_backups to service_role;
  end if;
end;
$$;
