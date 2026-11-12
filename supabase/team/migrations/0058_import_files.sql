-- Rukh, package 3 (3б, second half): files come over from the tracker to the team's Google
-- Drive, and what could not come is listed so it can be pulled later.
-- The same in supabase/migrations/20270113100000_import_files.sql.
-- Rollback: supabase/team/rollbacks/0058_import_files.down.sql

-- A file that came from the tracker may be large (250 MB; an archive up to 10 GB) and of
-- any kind: it lives only on the team's Google Drive and is handed out as a download.
-- Files attached here keep their limits (4 MB, the known kinds).
alter table public.task_files alter column bytes type bigint;
alter table public.task_files
  add column external_id text check (external_id is null or char_length(external_id) between 1 and 100),
  add column uploader_slot uuid references public.task_import_people (id) on delete set null;
alter table public.task_files drop constraint task_files_bytes_check;
alter table public.task_files add constraint task_files_bytes_check
  check (bytes >= 1 and bytes <= case when external_id is null then 4194304 when mime_type = 'application/zip' then 10737418240 else 262144000 end);
alter table public.task_files drop constraint task_files_mime_type_check;
alter table public.task_files add constraint task_files_mime_type_check
  check ((external_id is not null and storage_backend = 'drive' and mime_type ~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$') or ((mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text, 'image/webp'::text, 'application/pdf'::text, 'text/plain'::text, 'text/csv'::text, 'application/zip'::text, 'application/msword'::text, 'application/vnd.ms-excel'::text, 'application/vnd.ms-powerpoint'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text]))));
create unique index task_files_external_idx on public.task_files (task_id, external_id) where external_id is not null;
create index task_files_uploader_slot_idx on public.task_files (uploader_slot) where uploader_slot is not null;

-- What an import could not bring (a file too big, the tracker or the Drive refusing it):
-- kept so that it can be pulled again later. Seen by the project's owners and the
-- workspace's admins; written only by the server.
create table public.task_import_gaps (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  kind          text not null check (kind in ('file')),
  external_id   text not null check (char_length(external_id) between 1 and 100),
  name          text not null check (char_length(name) between 1 and 200),
  bytes         bigint,
  reason        text not null check (reason in ('too_big', 'empty', 'no_drive', 'no_space', 'tracker_error', 'drive_error')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (task_id, kind, external_id)
);
create index task_import_gaps_project_idx on public.task_import_gaps (project_id) where resolved_at is null;
alter table public.task_import_gaps enable row level security;
revoke all on public.task_import_gaps from public, anon, authenticated;
grant select on public.task_import_gaps to authenticated;
create policy task_import_gaps_select on public.task_import_gaps for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and (coalesce(public.task_project_role(project_id) = 'owner', false) or coalesce(public.is_workspace_admin(workspace_id), false)));

-- The import records a file it has put on the Drive (server only). Item: {external_key,
-- external_id, name, mime_type, bytes, drive_account_id, drive_file_id, author_ext,
-- created_at}. A second run replaces the record; a gap noted for the file is closed.
create function public.import_task_file(target_project uuid, item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  task uuid;
  seat public.task_import_people;
  file_id uuid := gen_random_uuid();
  mime text := lower(coalesce(item ->> 'mime_type', ''));
begin
  select * into project from public.task_projects where id = target_project;
  select t.id into task from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
  if project.id is null or task is null then
    return public.page_error('not_found');
  end if;
  if coalesce(item ->> 'external_id', '') = '' or coalesce(item ->> 'drive_file_id', '') = '' or (item ->> 'drive_account_id') is null
     or btrim(coalesce(item ->> 'name', '')) = '' or coalesce((item ->> 'bytes')::bigint, 0) < 1 then
    return public.page_error('invalid');
  end if;
  if mime !~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$' then
    mime := 'application/octet-stream';
  end if;
  select * into seat from public.task_import_people p where p.project_id = target_project and p.external_id = item ->> 'author_ext';
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id,
                                 drive_file_id, uploaded_by, uploader_slot, external_id, created_at)
  values (file_id, project.workspace_id, task, left(btrim(item ->> 'name'), 200), mime, (item ->> 'bytes')::bigint,
          project.workspace_id || '/tasks/' || task || '/' || file_id, 'drive', 'wiki', (item ->> 'drive_account_id')::uuid,
          item ->> 'drive_file_id', seat.user_id, seat.id, left(item ->> 'external_id', 100), coalesce((item ->> 'created_at')::timestamptz, now()))
  on conflict (task_id, external_id) where external_id is not null do update set
    name = excluded.name, mime_type = excluded.mime_type, bytes = excluded.bytes, drive_account_id = excluded.drive_account_id,
    drive_file_id = excluded.drive_file_id, uploader_slot = excluded.uploader_slot,
    uploaded_by = coalesce(public.task_files.uploaded_by, excluded.uploaded_by);
  update public.task_import_gaps set resolved_at = now()
  where task_id = task and kind = 'file' and external_id = left(item ->> 'external_id', 100) and resolved_at is null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.import_task_file(uuid, jsonb) from public, anon, authenticated;

-- …and what it could not bring (server only). Item: {external_key, external_id, name, bytes, reason}.
create function public.note_import_gap(target_project uuid, item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  task uuid;
begin
  select * into project from public.task_projects where id = target_project;
  select t.id into task from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
  if project.id is null or task is null then
    return public.page_error('not_found');
  end if;
  if coalesce(item ->> 'external_id', '') = '' or coalesce(item ->> 'reason', '') not in ('too_big', 'empty', 'no_drive', 'no_space', 'tracker_error', 'drive_error') then
    return public.page_error('invalid');
  end if;
  insert into public.task_import_gaps (workspace_id, project_id, task_id, kind, external_id, name, bytes, reason)
  values (project.workspace_id, target_project, task, 'file', left(item ->> 'external_id', 100),
          left(coalesce(nullif(btrim(item ->> 'name'), ''), '?'), 200), (item ->> 'bytes')::bigint, item ->> 'reason')
  on conflict (task_id, kind, external_id) do update set reason = excluded.reason, name = excluded.name, bytes = excluded.bytes, resolved_at = null, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.note_import_gap(uuid, jsonb) from public, anon, authenticated;

-- Seating a person hands over the files they attached in the tracker as well.
create or replace function public.seat_import_person(target_person uuid, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.task_import_people;
  previous uuid;
  held integer;
  wrote integer;
  said integer;
begin
  select * into person from public.task_import_people where id = target_person for update;
  if person.id is null
     or not (coalesce(public.task_project_role(person.project_id) = 'owner', false) or coalesce(public.is_workspace_admin(person.workspace_id), false)) then
    return public.page_error('forbidden');
  end if;
  if member is not null and not public.is_active_member(person.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;
  previous := person.user_id;
  perform set_config('ek.importing', 'on', true);
  perform set_config('ek.by_rule', 'on', true);
  update public.tasks set assignee_id = member, imported_assignee = case when member is null then person.name end
  where assignee_slot = person.id and assignee_id is not distinct from previous;
  get diagnostics held = row_count;
  update public.tasks set reporter_id = member, imported_reporter = case when member is null then person.name end
  where reporter_slot = person.id and reporter_id is not distinct from previous;
  get diagnostics wrote = row_count;
  -- The person's comments and history lines go with the seat too.
  update public.task_comments set author_id = member where author_slot = person.id and author_id is not distinct from previous;
  get diagnostics said = row_count;
  update public.task_events set actor_id = member where actor_slot = person.id and actor_id is not distinct from previous;
  update public.task_files set uploaded_by = member where uploader_slot = person.id and uploaded_by is not distinct from previous;
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote, 'comments', said);
end;
$$;
