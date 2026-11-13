-- Undoes VAULT-7 (20270215100000_vault_drive_browse.sql): functions as before, links and the switch gone.
alter table public.drive_connections drop column if exists can_browse;
drop trigger if exists vault_items_link_version on public.vault_items;
drop function if exists public.check_vault_link_version();
drop function if exists public.begin_vault_link(uuid, uuid, text, text, bigint);
drop function if exists public.set_vault_drive_browse(uuid, boolean);
-- Links go (their Drive files stay: the tombstone trigger is still the new one here).
delete from public.vault_items where storage_backend = 'drive_link';
create or replace function public.remember_deleted_vault_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'file' then
    insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
    values (old.storage_path, old.storage_backend, old.drive_account_id, old.drive_file_id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
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
drop policy "Members see the settings" on public.vault_settings;
create policy "Members see the settings" on public.vault_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and not public.is_guest(workspace_id, auth.uid()));
alter table public.vault_settings drop column if exists drive_browse;
alter table public.vault_items drop constraint if exists vault_items_drive_link_check;
alter table public.vault_items drop constraint vault_items_storage_backend_check;
alter table public.vault_items add constraint vault_items_storage_backend_check
  check (storage_backend in ('pending', 'supabase', 'drive'));
