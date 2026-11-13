-- VAULT-7 in a team's own database (as supabase/migrations/20270215100000_vault_drive_browse.sql;
-- the Drive's connection lives in the central database).
-- Rollback: supabase/team/rollbacks/0089_vault_drive_browse.down.sql

-- VAULT-7 (owner, 2026-11-13: «Погоджую план»): the team's Google Drive inside Vault.
-- Members (not guests) browse the Drive connected to the workspace while its owner keeps
-- the switch on (on by default). "Add to Vault" makes a link to the same Drive file: no
-- copy, no space taken. A link has Vault's own access (roles, folders, bin); removing it
-- never deletes the file on the Drive. A link has no versions.

alter table public.vault_items drop constraint vault_items_storage_backend_check;
alter table public.vault_items add constraint vault_items_storage_backend_check
  check (storage_backend in ('pending', 'supabase', 'drive', 'drive_link'));
alter table public.vault_items add constraint vault_items_drive_link_check
  check (storage_backend is distinct from 'drive_link' or (large and drive_account_id is not null and drive_file_id is not null));

alter table public.vault_settings add column drive_browse boolean not null default true;

-- Members read the settings (the switch, the limit). The rule called is_guest, which
-- members may not run, so every read failed: now the members' own check.
drop policy "Members see the settings" on public.vault_settings;
create policy "Members see the settings" on public.vault_settings
  for select to authenticated
  using (public.is_workspace_insider(workspace_id));

-- The switch: the workspace's owner only.
create function public.set_vault_drive_browse(ws uuid, browse boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.workspace_role(ws) is distinct from 'owner' or browse is null then
    return public.ws_error('forbidden');
  end if;
  insert into public.vault_settings (workspace_id, drive_browse, updated_at, updated_by)
  values (ws, browse, now(), auth.uid())
  on conflict (workspace_id) do update set drive_browse = excluded.drive_browse, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_vault_drive_browse(uuid, boolean) from public, anon;
grant execute on function public.set_vault_drive_browse(uuid, boolean) to authenticated;

-- Step 1 of a link: a record waiting for the server ("pending"), which then checks the
-- file on the Drive and points the record at it. No size limit of ours: it takes no space.
create function public.begin_vault_link(ws uuid, folder uuid, file_name text, file_type text, file_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  mime text := lower(coalesce(file_type, ''));
  path text;
begin
  if not public.vault_can_add(ws, folder)
     or not coalesce((select s.drive_browse from public.vault_settings s where s.workspace_id = ws), true) then
    return public.ws_error('forbidden');
  end if;
  if mime !~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$' then
    mime := 'application/octet-stream';
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 5497558138880 then
    return public.ws_error('invalid_file');
  end if;
  if (select count(*) from public.vault_items i where i.owner_id = auth.uid() and i.storage_backend = 'pending') >= 20 then
    return public.ws_error('too_many');
  end if;
  path := ws || '/vault/' || new_id;
  insert into public.vault_items (id, workspace_id, parent_id, kind, name, mime_type, bytes, storage_path, storage_backend, large, owner_id, updated_by)
  values (new_id, ws, folder, 'file', btrim(file_name), mime, file_bytes, path, 'pending', true, auth.uid(), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;
revoke execute on function public.begin_vault_link(uuid, uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_vault_link(uuid, uuid, text, text, bigint) to authenticated;

-- A removed link leaves the Drive's file alone (only Vault's own files are deleted).
create or replace function public.remember_deleted_vault_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'file' and old.storage_backend is distinct from 'drive_link' then
    insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
    values (old.storage_path, old.storage_backend, old.drive_account_id, old.drive_file_id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

-- A link has no versions: a new version of one is refused.
create function public.check_vault_link_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version_of is not null
     and (select i.storage_backend from public.vault_items i where i.id = new.version_of) = 'drive_link' then
    raise exception 'vault_link_version' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vault_link_version() from public, anon, authenticated;
create trigger vault_items_link_version before insert on public.vault_items
  for each row execute function public.check_vault_link_version();

-- The list says which files are links (they open on the Drive's terms, never get versions).
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
      'restricted', not i.inherit and i.workspace_role is null, 'link', i.storage_backend = 'drive_link',
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

-- Links take no space: left out of the usage.
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
        from public.vault_items f where f.workspace_id = ws and f.kind = 'file' and f.storage_backend not in ('pending', 'drive_link')
        union all
        select 'files', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.vault_versions f where f.workspace_id = ws
      ) s
      group by s.service
    ) x));
end;
$$;
