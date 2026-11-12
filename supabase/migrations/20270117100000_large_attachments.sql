-- Rukh, package 4-2: larger attachments for a project (a limit a workspace admin sets),
-- sent to the team's Google Drive in parts.
-- The same in supabase/team/migrations/0062_large_attachments.sql.
-- Rollback: supabase/rollbacks/20270117100000_large_attachments.down.sql

-- A project may take larger attachments than the usual 4 MB: a workspace admin sets the
-- largest file (up to 250 MB) and the largest ZIP archive (up to 10 GB) for it, and can set
-- them back. Larger files live only on the team's Google Drive and can be of any kind.
alter table public.task_projects
  add column file_limit_mb integer not null default 4 check (file_limit_mb between 4 and 250),
  add column zip_limit_mb integer not null default 4 check (zip_limit_mb between 4 and 10240);

alter table public.task_files add column large boolean not null default false;
alter table public.task_files drop constraint task_files_bytes_check;
alter table public.task_files add constraint task_files_bytes_check
  check (bytes >= 1 and bytes <= case when external_id is null and not large then 4194304 when mime_type = 'application/zip' then 10737418240 else 262144000 end);
alter table public.task_files drop constraint task_files_mime_type_check;
alter table public.task_files add constraint task_files_mime_type_check
  check ((((external_id is not null and storage_backend = 'drive') or (large and storage_backend in ('pending', 'drive')))
          and mime_type ~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$') or (mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text, 'image/webp'::text, 'application/pdf'::text, 'text/plain'::text, 'text/csv'::text, 'application/zip'::text, 'application/msword'::text, 'application/vnd.ms-excel'::text, 'application/vnd.ms-powerpoint'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text])));

-- Where an upload in parts stands (the address to send the next part to is for the server only).
create table public.task_uploads (
  file_id       uuid primary key references public.task_files (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  session       text not null,
  sent          bigint not null default 0,
  account_id    uuid not null,
  created_at    timestamptz not null default now()
);
alter table public.task_uploads enable row level security;
revoke all on public.task_uploads from public, anon, authenticated;

create function public.set_project_file_limits(target_project uuid, file_mb integer, zip_mb integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
begin
  if ws is null or not coalesce(public.is_workspace_admin(ws), false) then
    return public.page_error('forbidden');
  end if;
  if file_mb is null or zip_mb is null or file_mb not between 4 and 250 or zip_mb not between 4 and 10240 then
    return public.page_error('invalid');
  end if;
  update public.task_projects set file_limit_mb = file_mb, zip_limit_mb = zip_mb where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_project_file_limits(uuid, integer, integer) from public, anon;
grant execute on function public.set_project_file_limits(uuid, integer, integer) to authenticated;

-- A file over 4 MB starts here: whoever may edit the task, within the project's limits.
-- The record waits ("pending") until the server has sent every part to the Drive.
create function public.begin_large_task_file(target_task uuid, file_name text, file_type text, file_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  project public.task_projects;
  new_id uuid := gen_random_uuid();
  mime text := lower(coalesce(file_type, ''));
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  select * into project from public.task_projects where id = task.project_id;
  if mime !~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$' then
    mime := 'application/octet-stream';
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes < 1 then
    return public.page_error('invalid_file');
  end if;
  if file_bytes > (case when mime = 'application/zip' then project.zip_limit_mb else project.file_limit_mb end)::bigint * 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.task_files f where f.task_id = target_task) >= 100 then
    return public.page_error('too_many_files');
  end if;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by, large)
  values (new_id, task.workspace_id, target_task, btrim(file_name), mime, file_bytes, task.workspace_id || '/tasks/' || target_task || '/' || new_id, auth.uid(), true);
  return jsonb_build_object('ok', true, 'id', new_id, 'workspace_id', task.workspace_id);
end;
$$;
revoke execute on function public.begin_large_task_file(uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_large_task_file(uuid, text, text, bigint) to authenticated;
