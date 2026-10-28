-- Google Drive as a workspace's file storage.
--
-- The workspace owner connects the team's Google Drive; new images and covers
-- go to a folder there instead of Supabase Storage, existing files can be moved,
-- and pages are backed up to it daily. Documents keep the same
-- "ek-attachment:<path>" references: only the attachment row knows where the
-- bytes live, so moving files never touches page content.
--
-- The Drive access (an OAuth refresh token) is stored encrypted by the server
-- and is readable only with the server's secret key: no policy or function
-- returns it to a signed-in user.
-- Rollback: supabase/rollbacks/20261106100000_drive_storage.down.sql

create table public.drive_connections (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  account_email      text not null,
  root_folder_id     text not null,
  files_folder_id    text not null,
  backups_folder_id  text not null,
  token_encrypted    text not null,
  -- One active connection per workspace; older ones stay until their files are moved.
  active             boolean not null default true,
  status             text not null default 'ok' check (status in ('ok', 'error')),
  last_error         text,
  connected_by       uuid references public.profiles (id) on delete set null,
  connected_at       timestamptz not null default now(),
  last_backup_at     timestamptz
);

create unique index drive_connections_one_active on public.drive_connections (workspace_id) where active;

alter table public.drive_connections enable row level security;
-- No policies: only the server (secret key) reads or writes this table.
revoke all on public.drive_connections from anon, authenticated;

alter table public.attachments
  add column storage_backend text not null default 'supabase' check (storage_backend in ('supabase', 'drive')),
  add column drive_connection_id uuid references public.drive_connections (id) on delete set null,
  add column drive_file_id text;

-- Remember where a deleted file lived, so the daily job deletes it from the right place.
alter table public.attachment_tombstones
  add column storage_backend text not null default 'supabase',
  add column drive_connection_id uuid,
  add column drive_file_id text;

create or replace function public.remember_deleted_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
  values (old.storage_path, old.storage_backend, old.drive_connection_id, old.drive_file_id)
  on conflict do nothing;
  return old;
end;
$$;

-- Last daily backup of each page, per Drive connection.
create table public.page_backups (
  page_id            uuid not null references public.pages (id) on delete cascade,
  drive_connection_id uuid not null references public.drive_connections (id) on delete cascade,
  json_file_id       text not null,
  markdown_file_id   text not null,
  backed_up_at       timestamptz not null default now(),
  primary key (page_id, drive_connection_id)
);
alter table public.page_backups enable row level security;
revoke all on public.page_backups from anon, authenticated;

-------------------------------------------------------------------------------
-- Uploads: with Drive connected, the workspace's Supabase quota no longer applies
-------------------------------------------------------------------------------

create or replace function public.register_attachment(
  target_page uuid,
  file_type text,
  file_bytes integer,
  file_width integer,
  file_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page record;
  used bigint;
  new_id uuid := gen_random_uuid();
  path text;
  on_drive boolean;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  select p.workspace_id, p.deleted_at, w.storage_limit_mb into page
  from public.pages p join public.workspaces w on w.id = p.workspace_id
  where p.id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if file_type not in ('image/webp', 'image/jpeg', 'image/png', 'image/gif') then
    return public.page_error('unsupported_type');
  end if;
  if file_bytes is null or file_bytes < 1 or file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;

  on_drive := exists (
    select 1 from public.drive_connections c
    where c.workspace_id = page.workspace_id and c.active and c.status = 'ok'
  );
  if not on_drive then
    select coalesce(sum(bytes), 0) into used
    from public.attachments where workspace_id = page.workspace_id and storage_backend = 'supabase';
    if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
      return public.page_error('quota_exceeded');
    end if;
  end if;

  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
                   when 'image/png' then 'png' else 'gif' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path,
                            'backend', case when on_drive then 'drive' else 'supabase' end);
end;
$$;

-------------------------------------------------------------------------------
-- Status for the settings page (owner and admins; never the token)
-------------------------------------------------------------------------------

create function public.workspace_storage_status(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conn public.drive_connections;
begin
  if not public.is_workspace_admin(ws) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into conn from public.drive_connections c where c.workspace_id = ws and c.active;
  return jsonb_build_object(
    'ok', true,
    'drive', case when conn.id is null then null else jsonb_build_object(
      'account_email', conn.account_email,
      'root_folder_id', conn.root_folder_id,
      'status', conn.status,
      'last_error', conn.last_error,
      'connected_at', conn.connected_at,
      'connected_by', (select coalesce(p.name, p.email) from public.profiles p where p.id = conn.connected_by),
      'last_backup_at', conn.last_backup_at
    ) end,
    'supabase_bytes', (select coalesce(sum(bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase'),
    'limit_mb', (select storage_limit_mb from public.workspaces w where w.id = ws),
    'total_files', (select count(*) from public.attachments a where a.workspace_id = ws),
    -- Files not yet on the active Drive: what "move files" would still do.
    'to_move', case when conn.id is null then 0 else (
      select count(*) from public.attachments a
      where a.workspace_id = ws and (a.storage_backend <> 'drive' or a.drive_connection_id is distinct from conn.id)
    ) end
  );
end;
$$;

revoke execute on function public.workspace_storage_status(uuid) from public, anon, authenticated;
grant execute on function public.workspace_storage_status(uuid) to authenticated;

-- The server's secret key works as service_role (Supabase grants it by default;
-- stated here so the intent is explicit). Plain Postgres in CI has no such role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.drive_connections, public.page_backups to service_role;
  end if;
end;
$$;
