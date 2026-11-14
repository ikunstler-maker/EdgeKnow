-- VAULT-6 in a team's own database (as supabase/migrations/20270211150000_vault_versions.sql).
-- Rollback: supabase/team/rollbacks/0084_vault_versions.down.sql

-- A file's earlier versions. The item keeps the current bytes; uploading a new version
-- goes through a hidden upload row (version_of) that takes the item's place when done.
alter table public.vault_items
  add column version integer not null default 1 check (version >= 1),
  -- Who put the current bytes there (null: the owner, as at the first upload).
  add column content_by uuid references public.profiles (id) on delete set null,
  -- An upload of a new version of this item, not an item of its own (only its uploader sees it).
  add column version_of uuid references public.vault_items (id) on delete cascade,
  add constraint vault_items_version_of_check check (version_of is null or kind = 'file');
create index vault_items_version_of_idx on public.vault_items (version_of) where version_of is not null;

create table public.vault_versions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  item_id          uuid not null references public.vault_items (id) on delete cascade,
  version_no       integer not null check (version_no >= 1),
  name             text not null check (char_length(btrim(name)) between 1 and 200),
  mime_type        text not null check (mime_type ~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$'),
  bytes            bigint not null check (bytes between 1 and 5497558138880),
  storage_path     text not null unique,
  storage_backend  text not null check (storage_backend in ('supabase', 'drive')),
  drive_source     text check (drive_source in ('personal', 'wiki', 'project')),
  drive_account_id uuid,
  drive_file_id    text,
  large            boolean not null default false,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  replaced_at      timestamptz not null default now(),
  unique (item_id, version_no)
);
create index vault_versions_ws_idx on public.vault_versions (workspace_id, storage_backend);

create function public.check_vault_version_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select i.workspace_id from public.vault_items i where i.id = new.item_id) then
    raise exception 'vault_workspace_mismatch';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vault_version_workspace() from public, anon, authenticated;
create trigger vault_versions_workspace before insert or update of workspace_id, item_id on public.vault_versions
  for each row execute function public.check_vault_version_workspace();

-- A removed version's bytes go with the daily cleanup.
create function public.remember_deleted_vault_version()
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
revoke execute on function public.remember_deleted_vault_version() from public, anon, authenticated;
create trigger vault_versions_tombstone after delete on public.vault_versions
  for each row execute function public.remember_deleted_vault_version();

alter table public.vault_versions enable row level security;
revoke all on public.vault_versions from public, anon, authenticated;
grant select on public.vault_versions to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.vault_versions to service_role;
  end if;
end $$;
-- Whoever sees the file sees its versions.
create policy "Versions of the files the person sees" on public.vault_versions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.vault_role(item_id) is not null);

-- A new version's upload is seen only by whoever uploads it.
drop policy "Items the person has a role on" on public.vault_items;
create policy "Items the person has a role on" on public.vault_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.vault_role(id) is not null
         and ((storage_backend is distinct from 'pending' and version_of is null) or owner_id = auth.uid()));

-- Step 1 of a new version: a hidden upload row (the same checks as a new file), by whoever
-- edits the file. The bytes then go up as for any file; vault_finish_version swaps them in.
create function public.begin_vault_version(target uuid, file_name text, file_type text, file_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.vault_items;
  new_id uuid := gen_random_uuid();
  mime text := lower(coalesce(file_type, ''));
  limit_mb integer;
  is_large boolean := file_bytes > 4194304;
  path text;
begin
  select * into t from public.vault_items where id = target;
  if not found or t.kind <> 'file' or t.version_of is not null or not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  limit_mb := (select s.file_limit_mb from public.vault_settings s where s.workspace_id = t.workspace_id);
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
  -- The team's own storage has no limit of ours.
  path := t.workspace_id || '/vault/' || new_id;
  insert into public.vault_items (id, workspace_id, parent_id, kind, name, mime_type, bytes, storage_path, storage_backend, large, owner_id, updated_by, version_of)
  values (new_id, t.workspace_id, t.parent_id, 'file', btrim(file_name), mime, file_bytes, path, 'pending', is_large, auth.uid(), auth.uid(), target);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', t.workspace_id, 'large', is_large);
end;
$$;
revoke execute on function public.begin_vault_version(uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_vault_version(uuid, text, text, bigint) to authenticated;

-- Step 2: the uploaded bytes become the file's current version; what was current goes to
-- its versions (the file keeps its id, name, place and access, so every link shows the new
-- bytes). At most 50 earlier versions are kept: the oldest go.
create function public.vault_finish_version(upload uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.vault_items;
  t public.vault_items;
begin
  select * into u from public.vault_items where id = upload;
  if not found or u.version_of is null or u.owner_id is distinct from auth.uid() or u.storage_backend = 'pending' then
    return public.ws_error('forbidden');
  end if;
  select * into t from public.vault_items where id = u.version_of for update;
  if not found or not public.vault_editable(t.id) then
    return public.ws_error('forbidden');
  end if;
  insert into public.vault_versions (workspace_id, item_id, version_no, name, mime_type, bytes, storage_path, storage_backend,
                                     drive_source, drive_account_id, drive_file_id, large, uploaded_by, created_at)
  values (t.workspace_id, t.id, t.version, t.name, t.mime_type, t.bytes, t.storage_path, t.storage_backend,
          t.drive_source, t.drive_account_id, t.drive_file_id, t.large, coalesce(t.content_by, t.owner_id), t.updated_at);
  -- The upload row goes; its bytes stay (they now belong to the file).
  delete from public.vault_items where id = upload;
  delete from public.attachment_tombstones where storage_path = u.storage_path;
  update public.vault_items set
    mime_type = u.mime_type, bytes = u.bytes, storage_path = u.storage_path, storage_backend = u.storage_backend,
    drive_source = u.drive_source, drive_account_id = u.drive_account_id, drive_file_id = u.drive_file_id, large = u.large,
    version = t.version + 1, content_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
  where id = t.id;
  delete from public.vault_versions v
  where v.item_id = t.id and v.version_no <= (select max(x.version_no) - 50 from public.vault_versions x where x.item_id = t.id);
  return jsonb_build_object('ok', true, 'version', t.version + 1);
end;
$$;
revoke execute on function public.vault_finish_version(uuid) from public, anon;
grant execute on function public.vault_finish_version(uuid) to authenticated;

-- An earlier version becomes the current one again (what was current is kept as a version).
create function public.vault_restore_version(target_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vault_versions;
  t public.vault_items;
begin
  select * into v from public.vault_versions where id = target_version;
  if not found then
    return public.ws_error('forbidden');
  end if;
  select * into t from public.vault_items where id = v.item_id for update;
  if not found or not public.vault_editable(t.id) then
    return public.ws_error('forbidden');
  end if;
  delete from public.vault_versions where id = v.id;
  delete from public.attachment_tombstones where storage_path = v.storage_path;
  insert into public.vault_versions (workspace_id, item_id, version_no, name, mime_type, bytes, storage_path, storage_backend,
                                     drive_source, drive_account_id, drive_file_id, large, uploaded_by, created_at)
  values (t.workspace_id, t.id, t.version, t.name, t.mime_type, t.bytes, t.storage_path, t.storage_backend,
          t.drive_source, t.drive_account_id, t.drive_file_id, t.large, coalesce(t.content_by, t.owner_id), t.updated_at);
  update public.vault_items set
    mime_type = v.mime_type, bytes = v.bytes, storage_path = v.storage_path, storage_backend = v.storage_backend,
    drive_source = v.drive_source, drive_account_id = v.drive_account_id, drive_file_id = v.drive_file_id, large = v.large,
    version = t.version + 1, content_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
  where id = t.id;
  return jsonb_build_object('ok', true, 'version', t.version + 1);
end;
$$;
revoke execute on function public.vault_restore_version(uuid) from public, anon;
grant execute on function public.vault_restore_version(uuid) to authenticated;

-- An earlier version deleted for good (whoever edits the file).
create function public.vault_delete_version(target_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vault_versions;
begin
  select * into v from public.vault_versions where id = target_version;
  if not found or not public.vault_editable(v.item_id) then
    return public.ws_error('forbidden');
  end if;
  delete from public.vault_versions where id = v.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_delete_version(uuid) from public, anon;
grant execute on function public.vault_delete_version(uuid) to authenticated;


-- Uploads of new versions are not items to list.
create or replace function public.vault_list(ws uuid, folder uuid, bin boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path jsonb;
  here jsonb;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if folder is not null then
    select jsonb_build_object('id', f.id, 'name', f.name, 'role', public.vault_role(f.id)) into here
    from public.vault_items f
    where f.id = folder and f.workspace_id = ws and f.kind = 'folder' and f.deleted_at is null and public.vault_role(f.id) is not null;
    if here is null then
      return public.ws_error('not_found');
    end if;
    -- The way down from the top, as far as the person sees it.
    with recursive up as (
      select f.id, f.parent_id, f.name, 0 as depth from public.vault_items f where f.id = folder
      union all
      select p.id, p.parent_id, p.name, u.depth + 1 from up u join public.vault_items p on p.id = u.parent_id where u.depth < 200
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.depth desc), '[]'::jsonb) into path
    from up u where u.depth > 0 and public.vault_role(u.id) is not null;
  end if;
  return jsonb_build_object('ok', true, 'folder', here, 'path', coalesce(path, '[]'::jsonb), 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'name', i.name, 'mime_type', i.mime_type, 'bytes', i.bytes, 'parent_id', i.parent_id,
      'owner_id', i.owner_id, 'updated_at', i.updated_at, 'version', i.version, 'deleted_at', i.deleted_at, 'role', i.role,
      'restricted', not i.inherit and i.workspace_role is null,
      'shared', exists (select 1 from public.vault_access a where a.item_id = i.id) or exists (select 1 from public.vault_group_access g where g.item_id = i.id))
      order by i.kind desc, lower(i.name), i.id)
    from (
      select v.*, r.role
      from public.vault_items v
      cross join lateral (select public.vault_role(v.id) as role) r
      where v.workspace_id = ws and v.version_of is null and r.role is not null
        and case
          when bin then v.deleted_at is not null and v.trashed_with = v.id and public.role_rank(r.role) >= public.role_rank('editor')
          when folder is not null then v.parent_id = folder and v.deleted_at is null and (v.kind = 'folder' or v.storage_backend <> 'pending')
          else v.deleted_at is null and (v.kind = 'folder' or v.storage_backend <> 'pending')
               and (v.parent_id is null or public.vault_role(v.parent_id) is null)
        end
      order by v.kind desc, lower(v.name), v.id
      limit 2000
    ) i), '[]'::jsonb));
end;
$$;

-- A new version uploaded but never put in place goes after a day too.
create or replace function public.clean_vault_items()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.vault_items i
    where (i.trashed_with = i.id and i.deleted_at < now() - interval '30 days')
       or ((i.storage_backend = 'pending' or i.version_of is not null) and i.created_at < now() - interval '1 day')
    returning 1
  )
  select count(*)::integer from gone;
$$;

-- Earlier versions take space too.
create or replace function public.vault_storage_usage(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_workspace_admin(ws), false) then
    return public.ws_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'services', (
    select coalesce(jsonb_object_agg(x.service, jsonb_build_object('bytes', x.bytes, 'stored', x.stored)), '{}'::jsonb)
    from (
      select s.service, sum(s.bytes)::bigint as bytes, sum(s.stored)::bigint as stored
      from (
        select 'wiki' as service, a.bytes::bigint as bytes, case when a.storage_backend = 'supabase' then a.bytes else 0 end::bigint as stored
        from public.attachments a where a.workspace_id = ws
        union all
        select 'tasks', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.task_files f where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select o.service, f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.object_files f join public.service_objects o on o.id = f.object_id
        where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select 'chat', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.chat_files f where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select 'files', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.vault_items f where f.workspace_id = ws and f.kind = 'file' and f.storage_backend <> 'pending'
        union all
        select 'files', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.vault_versions f where f.workspace_id = ws
      ) s
      group by s.service
    ) x));
end;
$$;
