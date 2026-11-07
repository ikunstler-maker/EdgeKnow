-- Rollback: supabase/rollbacks/20261216100000_gallery_audio.down.sql
-- Wiki galleries: audio files (mp3, m4a, ogg, wav) next to images on a page.
-- Images stay up to 2 MB. Audio: up to 20 MB when the browser puts it straight into
-- EdgeKnow's storage; 4 MB when our server carries it (Google Drive, a team's own
-- storage), the most a server request may hold.

alter table public.attachments drop constraint attachments_mime_type_check;
alter table public.attachments add constraint attachments_mime_type_check check (mime_type in (
  'image/webp', 'image/jpeg', 'image/png', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'));
alter table public.attachments drop constraint attachments_bytes_check;
alter table public.attachments add constraint attachments_bytes_check check (bytes between 1 and 20971520);

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav']
where id = 'attachments';

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
  audio boolean := file_type in ('audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav');
  limit_bytes integer;
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
  if not audio and file_type not in ('image/webp', 'image/jpeg', 'image/png', 'image/gif') then
    return public.page_error('unsupported_type');
  end if;

  on_drive := exists (
    select 1 from public.drive_connections c
    where c.workspace_id = page.workspace_id and c.active and c.status = 'ok'
  );
  limit_bytes := case when not audio then 2097152 when on_drive or false then 4194304 else 20971520 end;
  if file_bytes is null or file_bytes < 1 or file_bytes > limit_bytes then
    return public.page_error('too_large');
  end if;
  if not on_drive then
    select coalesce(sum(bytes), 0) into used
    from public.attachments where workspace_id = page.workspace_id and storage_backend = 'supabase';
    if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
      return public.page_error('quota_exceeded');
    end if;
  end if;

  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
                   when 'image/gif' then 'gif' when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a'
                   when 'audio/ogg' then 'ogg' else 'wav' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path,
                            'backend', case when on_drive then 'drive' else 'supabase' end);
end;
$$;
