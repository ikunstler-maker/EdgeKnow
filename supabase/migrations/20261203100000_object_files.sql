-- Boards, step Д3b: pictures on boards, stored in the workspace's one storage.
-- The same in supabase/team/migrations/0020_object_files.sql.
-- Rollback: supabase/rollbacks/20261203100000_object_files.down.sql

-- Pictures on boards: one row per file, the bytes in the workspace's one storage
-- (its Google Drive, or EdgeKnow's / the team's storage), like task files.
create table public.object_files (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  object_id        uuid not null references public.service_objects (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  mime_type        text not null check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  bytes            integer not null check (bytes between 1 and 4194304),
  -- <workspace id>/objects/<object id>/<file id>, in the same private bucket as task files
  storage_path     text not null unique,
  storage_backend  text not null default 'pending' check (storage_backend in ('pending', 'supabase', 'drive')),
  drive_source     text check (drive_source in ('personal', 'wiki', 'project')),
  drive_account_id uuid,
  drive_file_id    text,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index object_files_object_idx on public.object_files (object_id, created_at);
create index object_files_workspace_idx on public.object_files (workspace_id, storage_backend);

create function public.check_object_file_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.object_id) then
    raise exception 'file and object must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger object_files_same_workspace before insert or update of workspace_id, object_id on public.object_files
  for each row execute function public.check_object_file_workspace();
-- A removed file (or one of a board deleted forever) goes with the daily cleanup.
create trigger object_files_tombstone after delete on public.object_files
  for each row execute function public.remember_deleted_task_file();

alter table public.object_files enable row level security;
revoke all on public.object_files from public, anon, authenticated;
grant select on public.object_files to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.object_files to service_role;
  end if;
end $$;
create policy "Members see the pictures of objects open to them"
  on public.object_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null);

-- Step 1 of adding a picture (editors of the board): a record and its path; the
-- server then stores the bytes in the workspace's one storage.
create function public.register_object_file(target_object uuid, file_name text, file_type text, file_bytes integer)
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
  if not found or object.deleted_at is not null or object.service <> 'boards'
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object) >= 500 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images and task files count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = object.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = object.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = object.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;
revoke execute on function public.check_object_file_workspace() from public, anon, authenticated;
revoke execute on function public.register_object_file(uuid, text, text, integer) from public, anon;
grant execute on function public.register_object_file(uuid, text, text, integer) to authenticated;

-- Task files: the limit now follows the one storage (no Drive connected), not the old per-project choice.
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
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
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
