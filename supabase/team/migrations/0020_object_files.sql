-- Boards, step Д3b, in a team's own database (as supabase/migrations/20261203100000_object_files.sql).
-- Rollback: supabase/team/rollbacks/0020_object_files.down.sql

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
  -- A team's own storage: its project's plan sets the limit.
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;
revoke execute on function public.check_object_file_workspace() from public, anon, authenticated;
revoke execute on function public.register_object_file(uuid, text, text, integer) from public, anon;
grant execute on function public.register_object_file(uuid, text, text, integer) to authenticated;
