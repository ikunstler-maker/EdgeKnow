-- Files attached to tasks (see supabase/migrations/20261125100000_task_files.sql).
-- Here EdgeKnow's storage is the team's own Supabase Storage.
-- Rollback: supabase/team/rollbacks/0011_task_files.down.sql

-------------------------------------------------------------------------------
-- Files attached to tasks
-------------------------------------------------------------------------------

-- Where a project's new files go: the uploader's own Google Drive (default),
-- the wiki's Drive, a Drive connected for this project, or EdgeKnow's storage
-- (for a team workspace: the team's own Supabase Storage).
alter table public.task_projects
  add column files_target text not null default 'personal' check (files_target in ('personal', 'wiki', 'project', 'edgeknow'));

create table public.task_files (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  task_id          uuid not null references public.tasks (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  mime_type        text not null check (mime_type in (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  bytes            integer not null check (bytes between 1 and 4194304),
  -- <workspace id>/tasks/<task id>/<file id>
  storage_path     text not null unique,
  -- 'pending' until the server has stored the bytes.
  storage_backend  text not null default 'pending' check (storage_backend in ('pending', 'supabase', 'drive')),
  -- Which Drive: the uploader's, the wiki's or the project's (drive_accounts or drive_connections id).
  drive_source     text check (drive_source in ('personal', 'wiki', 'project')),
  drive_account_id uuid,
  drive_file_id    text,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index task_files_task_idx on public.task_files (task_id, created_at);
create index task_files_uploader_idx on public.task_files (workspace_id, uploaded_by);

create function public.check_task_file_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.tasks t where t.id = new.task_id) then
    raise exception 'file and task must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger task_files_same_workspace before insert or update of workspace_id, task_id on public.task_files
  for each row execute function public.check_task_file_workspace();

-- A removed file is deleted from its storage by the daily cleanup.
create function public.remember_deleted_task_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
  values (old.storage_path, old.storage_backend, old.drive_account_id, old.drive_file_id)
  on conflict do nothing;
  return old;
end;
$$;
create trigger task_files_tombstone after delete on public.task_files
  for each row execute function public.remember_deleted_task_file();

alter table public.task_files enable row level security;
revoke all on public.task_files from public, anon, authenticated;
grant select on public.task_files to authenticated;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);

-- Step 1 of attaching a file (editors of the project): a record and its path.
-- The server then stores the bytes where the project says and fills in where.
create function public.register_task_file(target_task uuid, file_name text, file_type text, file_bytes integer)
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
  path := task.workspace_id || '/tasks/' || target_task || '/' || new_id;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, task.workspace_id, target_task, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'target', project.files_target,
                            'workspace_id', task.workspace_id, 'project_id', project.id);
end;
$$;

-- Remove a file: editors of the project, or the person who attached it.
create function public.delete_task_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  file public.task_files;
  role text;
begin
  select * into file from public.task_files where id = target_file;
  if not found then
    return public.page_error('forbidden');
  end if;
  role := public.task_project_role((select t.project_id from public.tasks t where t.id = file.task_id));
  if role is null or (public.role_rank(role) < public.role_rank('editor') and file.uploaded_by is distinct from auth.uid()) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_files where id = target_file;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.register_task_file(uuid, text, text, integer), public.delete_task_file(uuid) from public, anon;
grant execute on function public.register_task_file(uuid, text, text, integer), public.delete_task_file(uuid) to authenticated;

create or replace function public.update_task_project(target_project uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if changes ? 'name' and char_length(btrim(coalesce(changes ->> 'name', ''))) not between 1 and 80 then
    return public.page_error('invalid_name');
  end if;
  -- What a board card shows: built-in fields, or the project's own fields by id.
  if changes ? 'card_fields' and (jsonb_typeof(changes -> 'card_fields') <> 'array' or exists (
    select 1 from jsonb_array_elements_text(changes -> 'card_fields') f
    where f not in ('key', 'type', 'priority', 'assignee', 'reporter', 'labels', 'due', 'start', 'created', 'updated', 'estimate', 'subtasks')
      and not exists (select 1 from public.task_fields tf where tf.id::text = f and tf.project_id = target_project)
  )) then
    return public.page_error('invalid');
  end if;
  if changes ? 'files_target' and coalesce(changes ->> 'files_target', '') not in ('personal', 'wiki', 'project', 'edgeknow') then
    return public.page_error('invalid');
  end if;
  if changes ? 'workspace_role' and (changes ->> 'workspace_role') is not null
     and (changes ->> 'workspace_role') not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.task_projects set
    name = case when changes ? 'name' then btrim(changes ->> 'name') else name end,
    icon = case when changes ? 'icon' then nullif(btrim(coalesce(changes ->> 'icon', '')), '') else icon end,
    workspace_role = case when changes ? 'workspace_role' then changes ->> 'workspace_role' else workspace_role end,
    card_fields = case when changes ? 'card_fields' then array(select jsonb_array_elements_text(changes -> 'card_fields')) else card_fields end,
    files_target = case when changes ? 'files_target' then changes ->> 'files_target' else files_target end,
    sprints = case when changes ? 'sprints' then coalesce((changes ->> 'sprints')::boolean, sprints) else sprints end,
    archived_at = case when changes ? 'archived' then case when (changes ->> 'archived')::boolean then now() end else archived_at end
  where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;
