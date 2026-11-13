-- The same in supabase/team/migrations/0080_vault_files.sql.
-- Rollback: supabase/rollbacks/20270207100000_vault_files.down.sql

-- VAULT-2 (decision 2026-11-13): Vault's own folders and files, shared as on a Drive.
-- An item (folder or file) is seen by: its owner; everyone in the workspace (not guests)
-- while the chain up to the top inherits ("general access": workspace members as viewers
-- by default, or as editors); people and units given a role on it or on a folder above
-- it. An item that does not inherit keeps only its own list. Every member (not guests)
-- may add at the top; inside a folder whoever edits it. The bin keeps items 30 days.
-- The bytes go where the workspace keeps its files (its Drive, or EdgeKnow's storage up
-- to 4 MB a file); larger files go to the Drive in parts. A workspace admin may limit
-- the size of a file (no limit by default).

create table public.vault_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  parent_id        uuid references public.vault_items (id) on delete cascade,
  kind             text not null check (kind in ('folder', 'file')),
  name             text not null check (char_length(btrim(name)) between 1 and 200),
  mime_type        text,
  bytes            bigint,
  -- <workspace id>/vault/<item id>
  storage_path     text unique,
  storage_backend  text check (storage_backend in ('pending', 'supabase', 'drive')),
  drive_source     text check (drive_source in ('personal', 'wiki', 'project')),
  drive_account_id uuid,
  drive_file_id    text,
  large            boolean not null default false,
  owner_id         uuid references public.profiles (id) on delete set null,
  -- General access: inherit from the folder above (the top inherits the workspace's
  -- default, members as viewers); workspace_role overrides it on this item and below.
  inherit          boolean not null default true,
  workspace_role   text check (workspace_role in ('viewer', 'editor')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id) on delete set null,
  -- The item whose removal took this one to the bin (itself for the one removed).
  trashed_with     uuid,
  check (parent_id is distinct from id),
  check ((kind = 'folder' and mime_type is null and bytes is null and storage_path is null and storage_backend is null and not large)
      or (kind = 'file' and mime_type ~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$'
          and bytes between 1 and 5497558138880 and storage_path is not null and storage_backend is not null
          and (large or bytes <= 4194304)))
);
create index vault_items_parent_idx on public.vault_items (workspace_id, parent_id) where deleted_at is null;
create index vault_items_bin_idx on public.vault_items (workspace_id, deleted_at) where deleted_at is not null;
create index vault_items_ws_idx on public.vault_items (workspace_id, storage_backend);

create table public.vault_access (
  item_id       uuid not null references public.vault_items (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('viewer', 'editor')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index vault_access_user_idx on public.vault_access (user_id);

create table public.vault_group_access (
  item_id       uuid not null references public.vault_items (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  role          text not null check (role in ('viewer', 'editor')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (item_id, group_id)
);
create index vault_group_access_group_idx on public.vault_group_access (group_id);

-- The workspace's own Vault settings: the largest file (null: no limit of ours).
create table public.vault_settings (
  workspace_id   uuid primary key references public.workspaces (id) on delete cascade,
  file_limit_mb  integer check (file_limit_mb between 1 and 5242880),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null
);

-- Where an upload in parts stands (the address of the next part is for the server only).
create table public.vault_uploads (
  file_id       uuid primary key references public.vault_items (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  session       text not null,
  sent          bigint not null default 0,
  account_id    uuid not null,
  created_at    timestamptz not null default now()
);

-- Parents, grants and units stay inside the item's workspace.
create function public.check_vault_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'vault_items' then
    if new.parent_id is not null and not exists (
      select 1 from public.vault_items p where p.id = new.parent_id and p.workspace_id = new.workspace_id and p.kind = 'folder') then
      raise exception 'vault_workspace_mismatch';
    end if;
  else
    if new.workspace_id is distinct from (select i.workspace_id from public.vault_items i where i.id = new.item_id) then
      raise exception 'vault_workspace_mismatch';
    end if;
    -- (a record has only its own table's fields, so the unit is looked at only here)
    if tg_table_name = 'vault_group_access' then
      if new.workspace_id is distinct from (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) then
        raise exception 'vault_workspace_mismatch';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vault_workspace() from public, anon, authenticated;
create trigger vault_items_workspace before insert or update of workspace_id, parent_id on public.vault_items
  for each row execute function public.check_vault_workspace();
create trigger vault_access_workspace before insert or update on public.vault_access
  for each row execute function public.check_vault_workspace();
create trigger vault_group_access_workspace before insert or update on public.vault_group_access
  for each row execute function public.check_vault_workspace();

-- A removed file is deleted from its storage by the daily cleanup (folders have no bytes).
create function public.remember_deleted_vault_file()
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
revoke execute on function public.remember_deleted_vault_file() from public, anon, authenticated;
create trigger vault_items_tombstone after delete on public.vault_items
  for each row execute function public.remember_deleted_vault_file();

-- The item and the folders it inherits from: walking up stops after an item that does
-- not inherit. `reaches_top`: the last one inherits and has no folder above it.
create function public.vault_chain(target uuid)
returns table (id uuid, depth integer, owner_id uuid, workspace_role text, reaches_top boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select i.id, i.parent_id, i.inherit, i.owner_id, i.workspace_role, 0 as depth
    from public.vault_items i where i.id = target
    union all
    select p.id, p.parent_id, p.inherit, p.owner_id, p.workspace_role, c.depth + 1
    from chain c join public.vault_items p on p.id = c.parent_id
    where c.inherit and c.depth < 50
  )
  select c.id, c.depth, c.owner_id, c.workspace_role, (c.inherit and c.parent_id is null) from chain c;
$$;
revoke execute on function public.vault_chain(uuid) from public, anon, authenticated;

-- A person's role on an item: 'owner' | 'editor' | 'viewer' | null. Guests and people
-- no longer in the workspace have none. The highest of: owning it (owner) or a folder
-- above it (editor); the workspace's general access (as the person's workspace role
-- allows); their own grants and their units' grants along the chain.
create function public.vault_role_of(target uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with item as (
    select i.workspace_id from public.vault_items i where i.id = target
  ),
  allowed as (
    select public.is_active_member((select workspace_id from item), member)
       and not public.is_guest((select workspace_id from item), member) as yes
  ),
  chain as (
    select c.* from public.vault_chain(target) c
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role from chain c where c.owner_id = member
    union all
    select public.capped_role((select workspace_id from item), member, c.workspace_role) from chain c where c.workspace_role is not null
    union all
    select public.capped_role((select workspace_id from item), member, 'viewer') from chain c where c.reaches_top
    union all
    select a.role from chain c join public.vault_access a on a.item_id = c.id and a.user_id = member
    union all
    select ga.role from chain c join public.vault_group_access ga on ga.item_id = c.id
    where public.unit_reaches(ga.group_id, member)
  )
  select role from candidates
  where member is not null and (select yes from allowed)
  order by public.role_rank(role) desc limit 1;
$$;
revoke execute on function public.vault_role_of(uuid, uuid) from public, anon, authenticated;

create function public.vault_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.vault_role_of(target, auth.uid());
$$;
revoke execute on function public.vault_role(uuid) from public, anon;
grant execute on function public.vault_role(uuid) to authenticated;

alter table public.vault_items enable row level security;
alter table public.vault_access enable row level security;
alter table public.vault_group_access enable row level security;
alter table public.vault_settings enable row level security;
alter table public.vault_uploads enable row level security;
revoke all on public.vault_items, public.vault_access, public.vault_group_access, public.vault_settings, public.vault_uploads
  from public, anon, authenticated;
grant select on public.vault_items, public.vault_access, public.vault_group_access, public.vault_settings to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.vault_items, public.vault_access, public.vault_group_access,
      public.vault_settings, public.vault_uploads to service_role;
  end if;
end $$;
-- A file still being uploaded is seen only by whoever uploads it.
create policy "Items the person has a role on" on public.vault_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.vault_role(id) is not null
         and (storage_backend is distinct from 'pending' or owner_id = auth.uid()));
create policy "Grants on items the person sees" on public.vault_access
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.vault_role(item_id) is not null);
create policy "Unit grants on items the person sees" on public.vault_group_access
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.vault_role(item_id) is not null);
create policy "Members see the settings" on public.vault_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and not public.is_guest(workspace_id, auth.uid()));

-- The bytes in EdgeKnow's storage (or the team's own): a private bucket only the server
-- touches, any kind of file, 4 MB at most (larger ones live on the Drive).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vault-files', 'vault-files', false, 4194304, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

-- May the person add to this folder (null: the top of the workspace)?
create function public.vault_can_add(ws uuid, folder uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
     and (folder is null or exists (
       select 1 from public.vault_items f
       where f.id = folder and f.workspace_id = ws and f.kind = 'folder' and f.deleted_at is null
         and public.role_rank(public.vault_role(f.id)) >= public.role_rank('editor')));
$$;
revoke execute on function public.vault_can_add(uuid, uuid) from public, anon, authenticated;

create function public.vault_create_folder(ws uuid, folder uuid, folder_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  made uuid;
begin
  if not public.vault_can_add(ws, folder) then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(folder_name, ''))) not between 1 and 200 then
    return public.ws_error('invalid_name');
  end if;
  insert into public.vault_items (workspace_id, parent_id, kind, name, owner_id, updated_by)
  values (ws, folder, 'folder', btrim(folder_name), auth.uid(), auth.uid())
  returning id into made;
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;
revoke execute on function public.vault_create_folder(uuid, uuid, text) from public, anon;
grant execute on function public.vault_create_folder(uuid, uuid, text) to authenticated;

-- Step 1 of adding a file: a record waiting for its bytes ("pending"). The server then
-- checks and stores them (up to 4 MB), or sends a larger one to the Drive in parts.
-- Within the admin's limit; without a Drive, within the workspace's storage.
create function public.begin_vault_file(ws uuid, folder uuid, file_name text, file_type text, file_bytes bigint)
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
revoke execute on function public.begin_vault_file(uuid, uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_vault_file(uuid, uuid, text, text, bigint) to authenticated;

-- Changes to an item: whoever edits it (not while it is in the bin).
create function public.vault_editable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vault_items i where i.id = target and i.deleted_at is null
                   and (i.kind = 'folder' or i.storage_backend <> 'pending'))
     and public.role_rank(public.vault_role(target)) >= public.role_rank('editor');
$$;
revoke execute on function public.vault_editable(uuid) from public, anon, authenticated;

create function public.vault_rename(target uuid, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 200 then
    return public.ws_error('invalid_name');
  end if;
  update public.vault_items set name = btrim(new_name), updated_at = now(), updated_by = auth.uid() where id = target;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_rename(uuid, text) from public, anon;
grant execute on function public.vault_rename(uuid, text) to authenticated;

-- Into another folder (null: the top) the person may add to; never into itself or below.
create function public.vault_move(target uuid, folder uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select i.workspace_id from public.vault_items i where i.id = target);
begin
  if not public.vault_editable(target) or not public.vault_can_add(ws, folder) then
    return public.ws_error('forbidden');
  end if;
  if folder is not null and exists (
    with recursive up as (
      select f.id, f.parent_id, 0 as depth from public.vault_items f where f.id = folder
      union all
      select p.id, p.parent_id, u.depth + 1 from up u join public.vault_items p on p.id = u.parent_id where u.depth < 200
    )
    select 1 from up where up.id = target) then
    return public.ws_error('invalid_folder');
  end if;
  update public.vault_items set parent_id = folder, updated_at = now(), updated_by = auth.uid() where id = target;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_move(uuid, uuid) from public, anon;
grant execute on function public.vault_move(uuid, uuid) to authenticated;

-- To the bin with everything inside (what was already there stays on its own).
create function public.vault_trash(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  with recursive down as (
    select i.id, 0 as depth from public.vault_items i where i.id = target
    union all
    select c.id, d.depth + 1 from down d join public.vault_items c on c.parent_id = d.id and c.deleted_at is null where d.depth < 200
  )
  update public.vault_items set deleted_at = now(), deleted_by = auth.uid(), trashed_with = target
  where id in (select id from down);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_trash(uuid) from public, anon;
grant execute on function public.vault_trash(uuid) to authenticated;

-- What was removed to the bin, by whoever may edit it. A folder that is gone meanwhile:
-- the item comes back at the top.
create function public.vault_bin_item(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vault_items i where i.id = target and i.deleted_at is not null and i.trashed_with = i.id)
     and public.role_rank(public.vault_role(target)) >= public.role_rank('editor');
$$;
revoke execute on function public.vault_bin_item(uuid) from public, anon, authenticated;

create function public.vault_restore(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.vault_bin_item(target) then
    return public.ws_error('forbidden');
  end if;
  update public.vault_items set parent_id = null
  where id = target and parent_id is not null
    and exists (select 1 from public.vault_items p where p.id = vault_items.parent_id and p.deleted_at is not null);
  update public.vault_items set deleted_at = null, deleted_by = null, trashed_with = null, updated_at = now(), updated_by = auth.uid()
  where trashed_with = target;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_restore(uuid) from public, anon;
grant execute on function public.vault_restore(uuid) to authenticated;

create function public.vault_delete_forever(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.vault_bin_item(target) then
    return public.ws_error('forbidden');
  end if;
  delete from public.vault_items where id = target;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_delete_forever(uuid) from public, anon;
grant execute on function public.vault_delete_forever(uuid) to authenticated;

-- One folder's contents with the person's role on each ("bin": the person's bin). At the
-- top also what was shared with the person inside a folder they don't see.
create function public.vault_list(ws uuid, folder uuid, bin boolean default false)
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
      'owner_id', i.owner_id, 'updated_at', i.updated_at, 'deleted_at', i.deleted_at, 'role', i.role,
      'restricted', not i.inherit and i.workspace_role is null,
      'shared', exists (select 1 from public.vault_access a where a.item_id = i.id) or exists (select 1 from public.vault_group_access g where g.item_id = i.id))
      order by i.kind desc, lower(i.name), i.id)
    from (
      select v.*, r.role
      from public.vault_items v
      cross join lateral (select public.vault_role(v.id) as role) r
      where v.workspace_id = ws and r.role is not null
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
revoke execute on function public.vault_list(uuid, uuid, boolean) from public, anon;
grant execute on function public.vault_list(uuid, uuid, boolean) to authenticated;

-- Who has access, for the sharing dialog: whoever sees the item.
create function public.vault_sharing(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.vault_items;
  mine text := public.vault_role(target);
  general text;
begin
  select * into i from public.vault_items where id = target;
  if not found or mine is null then
    return public.ws_error('forbidden');
  end if;
  -- What the workspace gets from above when this item inherits.
  select coalesce(
    (select c.workspace_role from public.vault_chain(target) c where c.depth > 0 and c.workspace_role is not null order by c.depth limit 1),
    case when (select bool_or(c.reaches_top) from public.vault_chain(target) c) then 'viewer' end)
  into general;
  return jsonb_build_object('ok', true, 'role', mine, 'owner_id', i.owner_id, 'inherit', i.inherit,
    'workspace_role', i.workspace_role, 'inherited_workspace_role', case when i.inherit then general end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role) order by a.created_at)
                        from public.vault_access a where a.item_id = target), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('group_id', g.group_id, 'role', g.role) order by g.created_at)
                       from public.vault_group_access g where g.item_id = target), '[]'::jsonb));
end;
$$;
revoke execute on function public.vault_sharing(uuid) from public, anon;
grant execute on function public.vault_sharing(uuid) to authenticated;

-- A person's role (null: taken away). Only members, never guests; not the owner.
create function public.vault_set_member_role(target uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.vault_items;
begin
  select * into i from public.vault_items where id = target;
  if not found or not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  if new_role is null then
    delete from public.vault_access where item_id = target and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('viewer', 'editor') or member is null or member = i.owner_id
     or not public.is_active_member(i.workspace_id, member) or public.is_guest(i.workspace_id, member) then
    return public.ws_error('invalid');
  end if;
  insert into public.vault_access (item_id, workspace_id, user_id, role, granted_by)
  values (target, i.workspace_id, member, new_role, auth.uid())
  on conflict (item_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.vault_set_member_role(uuid, uuid, text) to authenticated;

create function public.vault_set_group_role(target uuid, grp uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.vault_items;
begin
  select * into i from public.vault_items where id = target;
  if not found or not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  if new_role is null then
    delete from public.vault_group_access where item_id = target and group_id = grp;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('viewer', 'editor')
     or not exists (select 1 from public.workspace_groups g where g.id = grp and g.workspace_id = i.workspace_id) then
    return public.ws_error('invalid');
  end if;
  insert into public.vault_group_access (item_id, workspace_id, group_id, role, granted_by)
  values (target, i.workspace_id, grp, new_role, auth.uid())
  on conflict (item_id, group_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_set_group_role(uuid, uuid, text) from public, anon;
grant execute on function public.vault_set_group_role(uuid, uuid, text) to authenticated;

-- General access: inherit from above, or this item's own (workspace members as viewers
-- or editors, or nobody but the people and units listed).
create function public.vault_set_general(target uuid, new_inherit boolean, new_workspace_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  if new_inherit is null or (new_workspace_role is not null and new_workspace_role not in ('viewer', 'editor')) then
    return public.ws_error('invalid');
  end if;
  update public.vault_items set inherit = new_inherit, workspace_role = new_workspace_role, updated_at = now(), updated_by = auth.uid()
  where id = target;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.vault_set_general(uuid, boolean, text) from public, anon;
grant execute on function public.vault_set_general(uuid, boolean, text) to authenticated;

-- The largest file (null: no limit of ours): the workspace's owner and admins.
create function public.set_vault_file_limit(ws uuid, limit_mb integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_workspace_admin(ws), false) then
    return public.ws_error('forbidden');
  end if;
  if limit_mb is not null and limit_mb not between 1 and 5242880 then
    return public.ws_error('invalid');
  end if;
  insert into public.vault_settings (workspace_id, file_limit_mb, updated_at, updated_by)
  values (ws, limit_mb, now(), auth.uid())
  on conflict (workspace_id) do update set file_limit_mb = excluded.file_limit_mb, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_vault_file_limit(uuid, integer) from public, anon;
grant execute on function public.set_vault_file_limit(uuid, integer) to authenticated;

-- The daily cleanup (server only): the bin after 30 days, uploads never finished after a day.
create function public.clean_vault_items()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.vault_items i
    where (i.trashed_with = i.id and i.deleted_at < now() - interval '30 days')
       or (i.storage_backend = 'pending' and i.created_at < now() - interval '1 day')
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke execute on function public.clean_vault_items() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clean_vault_items() to service_role;
  end if;
end $$;
