-- Undo 20261106100000_drive_storage.sql. Files already on Google Drive stay there
-- but are no longer shown; move them back first (settings → storage) if needed.
drop function if exists public.workspace_storage_status(uuid);

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
  select coalesce(sum(bytes), 0) into used from public.attachments where workspace_id = page.workspace_id;
  if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
    return public.page_error('quota_exceeded');
  end if;
  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
                   when 'image/png' then 'png' else 'gif' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path);
end;
$$;

create or replace function public.remember_deleted_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_tombstones (storage_path) values (old.storage_path)
  on conflict do nothing;
  return old;
end;
$$;

drop table if exists public.page_backups;
alter table public.attachment_tombstones
  drop column if exists storage_backend, drop column if exists drive_connection_id, drop column if exists drive_file_id;
alter table public.attachments
  drop column if exists storage_backend, drop column if exists drive_connection_id, drop column if exists drive_file_id;
drop table if exists public.drive_connections;
