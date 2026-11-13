-- Undo 20270210100000_vault_storage.

drop function public.vault_storage_usage(uuid);

create or replace function public.register_task_file(target_task uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  project public.task_projects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or not public.task_permits(task.id, 'file_add') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.task_files f where f.task_id = target_task) >= 100 then
    return public.page_error('too_many_files');
  end if;
  select * into project from public.task_projects where id = task.project_id;
  -- EdgeKnow's storage has the workspace's limit (wiki images and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = task.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = task.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = task.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := task.workspace_id || '/tasks/' || target_task || '/' || new_id;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, task.workspace_id, target_task, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'target', project.files_target,
                            'workspace_id', task.workspace_id, 'project_id', project.id);
end;
$$;

create or replace function public.register_object_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or object.service not in ('boards', 'slides', 'apps', 'wishlists')
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') then
    return public.page_error('invalid_file');
  end if;
  -- A company app's logo: one small picture, 2 MB at most.
  if object.service = 'apps' and file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object) >= 500 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images and task files count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = object.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = object.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = object.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;

create or replace function public.register_survey_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  st public.survey_settings;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if ws is null or public.service_object_role(target_object) is null then
    return public.page_error('forbidden');
  end if;
  select * into st from public.survey_settings where object_id = target_object;
  if not coalesce(st.accepting, true) or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object and f.uploaded_by = auth.uid() and f.created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.object_files f where f.object_id = target_object) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

create or replace function public.register_public_survey_file(token text, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  ws uuid;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into st from public.survey_settings s where s.public_token = token and s.public_enabled;
  ws := (select o.workspace_id from public.service_objects o where o.id = st.object_id and o.deleted_at is null);
  if ws is null then
    return public.page_error('not_found');
  end if;
  if not st.accepting or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = st.object_id and f.created_at > now() - interval '1 hour') >= 300
     or (select count(*) from public.object_files f where f.object_id = st.object_id) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || st.object_id || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, st.object_id, btrim(file_name), file_type, file_bytes, path, null);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

create or replace function public.register_chat_file(ch uuid, file_name text, file_type text, file_bytes integer, file_kind text, duration integer, file_width integer, file_height integer, levels smallint[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) or c.archived_at is not null then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 10485760
     or coalesce(file_kind, 'file') not in ('file', 'image', 'voice')
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg')
     or (file_kind = 'image' and file_type not like 'image/%')
     or (file_kind = 'voice' and (file_type not like 'audio/%' or duration is null or duration not between 0 and 300000)) then
    return public.ws_error('invalid_file');
  end if;
  -- A voice message's look: 28 to 64 levels of 0..5 (made in the browser from the sound).
  if levels is not null and (file_kind <> 'voice' or cardinality(levels) not between 1 and 64
     or exists (select 1 from unnest(levels) l where l is null or l not between 0 and 5)) then
    return public.ws_error('invalid_file');
  end if;
  if (select count(*) from public.chat_files f where f.uploaded_by = auth.uid() and f.message_id is null) >= 20 then
    return public.ws_error('too_many');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections dc where dc.workspace_id = c.workspace_id and dc.active and dc.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = c.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = c.workspace_id) then
    return public.ws_error('quota_exceeded');
  end if;
  path := c.workspace_id || '/chat/' || ch || '/' || new_id;
  insert into public.chat_files (id, workspace_id, channel_id, name, mime_type, bytes, kind, duration_ms, width, height, storage_path, uploaded_by, waveform)
  values (new_id, c.workspace_id, ch, btrim(file_name), file_type, file_bytes, coalesce(file_kind, 'file'),
          case when file_kind = 'voice' then duration end,
          case when file_width > 0 then file_width end, case when file_height > 0 then file_height end, path, auth.uid(), levels);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', c.workspace_id);
end;
$$;

create or replace function public.begin_vault_file(ws uuid, folder uuid, file_name text, file_type text, file_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  mime text := lower(coalesce(file_type, ''));
  limit_mb integer := (select s.file_limit_mb from public.vault_settings s where s.workspace_id = ws);
  is_large boolean := file_bytes > 4194304;
  path text;
begin
  if not public.vault_can_add(ws, folder) then
    return public.ws_error('forbidden');
  end if;
  if mime !~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$' then
    mime := 'application/octet-stream';
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 5497558138880 then
    return public.ws_error('invalid_file');
  end if;
  if limit_mb is not null and file_bytes > limit_mb::bigint * 1048576 then
    return public.ws_error('too_large');
  end if;
  if (select count(*) from public.vault_items i where i.owner_id = auth.uid() and i.storage_backend = 'pending') >= 20 then
    return public.ws_error('too_many');
  end if;
  -- EdgeKnow's storage has the workspace's limit (every service's files count).
  if not is_large and not exists (select 1 from public.drive_connections dc where dc.workspace_id = ws and dc.active and dc.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.vault_items f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.ws_error('quota_exceeded');
  end if;
  path := ws || '/vault/' || new_id;
  insert into public.vault_items (id, workspace_id, parent_id, kind, name, mime_type, bytes, storage_path, storage_backend, large, owner_id, updated_by)
  values (new_id, ws, folder, 'file', btrim(file_name), mime, file_bytes, path, 'pending', is_large, auth.uid(), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws, 'large', is_large);
end;
$$;

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

create or replace function public.departed_page_owners(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'owners', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', x.name, 'email', x.email, 'pages', x.pages)
             order by x.email)
    from (
      select p.owner_id, pr.name, pr.email, count(*) as pages
      from public.pages p
      join public.profiles pr on pr.id = p.owner_id
      where p.workspace_id = ws and not public.is_active_member(ws, p.owner_id)
      group by p.owner_id, pr.name, pr.email
    ) x
  ), '[]'::jsonb));
end;
$$;

create or replace function public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'reassign_member_pages'));
    return public.page_error('forbidden');
  end if;
  if public.is_active_member(ws, from_user) then
    return public.page_error('still_a_member');
  end if;
  if not public.is_active_member(ws, to_user) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access a
  using public.pages p
  where a.page_id = p.id and p.workspace_id = ws and p.owner_id = from_user and a.user_id = to_user;
  update public.pages set owner_id = to_user where workspace_id = ws and owner_id = from_user;
  get diagnostics moved = row_count;
  perform public.log_workspace_action(ws, 'pages_reassigned', jsonb_build_object(
    'from', (select email from public.profiles where id = from_user),
    'to', (select email from public.profiles where id = to_user),
    'pages', moved));
  return jsonb_build_object('ok', true, 'pages', moved);
end;
$$;

drop function public.workspace_storage_used(uuid);
