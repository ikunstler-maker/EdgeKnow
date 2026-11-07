-- The same in supabase/team/migrations/0034_collections.sql.
-- Rollback: supabase/rollbacks/20261219100000_collections.down.sql

-- Sidebar collections: named groups of a service's objects (tables, whiteboards, maps,
-- surveys; later slides, sites, apps), shared by the whole workspace. An object stays one
-- row with one id and can sit in several collections (a link table, never a copy).
-- Everyone in the workspace sees the collections; the objects in them only when they may
-- open the object anyway. Members and admins (not guests) make and change collections;
-- putting an object in one also needs the editor role on that object.

create table public.object_collections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  service       text not null check (service in ('nodes', 'boards', 'sheets', 'slides', 'surveys', 'sites', 'apps')),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  position      double precision not null default 0,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index object_collections_ws_idx on public.object_collections (workspace_id, service, position);

create table public.object_collection_items (
  collection_id uuid not null references public.object_collections (id) on delete cascade,
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  position      double precision not null default 0,
  primary key (collection_id, object_id)
);
create index object_collection_items_object_idx on public.object_collection_items (object_id);

alter table public.object_collections enable row level security;
alter table public.object_collection_items enable row level security;
revoke all on public.object_collections, public.object_collection_items from public, anon, authenticated;
grant select on public.object_collections, public.object_collection_items to authenticated;
create policy "Members see their workspace's collections"
  on public.object_collections for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "Members see collection entries of objects open to them"
  on public.object_collection_items for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null);

-- Members and admins of the workspace (not guests).
create function public.can_manage_collections(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid());
$$;

-- Make (collection_id null) or rename / move a collection.
create function public.save_object_collection(ws uuid, collection_id uuid, new_service text, new_name text, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
begin
  if not public.can_manage_collections(ws) then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 then
    return public.page_error('invalid_name');
  end if;
  if collection_id is null then
    if not coalesce(new_service in ('nodes', 'boards', 'sheets', 'slides', 'surveys', 'sites', 'apps'), false) then
      return public.page_error('invalid');
    end if;
    if (select count(*) from public.object_collections c where c.workspace_id = ws) >= 500 then
      return public.page_error('too_many');
    end if;
    insert into public.object_collections (workspace_id, service, name, position, created_by)
    values (ws, new_service, btrim(new_name),
            coalesce(new_position, (select max(c.position) from public.object_collections c where c.workspace_id = ws and c.service = new_service), 0) + case when new_position is null then 1 else 0 end,
            auth.uid())
    returning id into saved;
  else
    update public.object_collections c set
      name = btrim(new_name),
      position = coalesce(new_position, c.position)
    where c.id = collection_id and c.workspace_id = ws
    returning c.id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

-- Removing a collection keeps its objects.
create function public.delete_object_collection(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select c.workspace_id from public.object_collections c where c.id = target);
begin
  if ws is null or not public.can_manage_collections(ws) then
    return public.page_error('not_found');
  end if;
  delete from public.object_collections c where c.id = target;
  return jsonb_build_object('ok', true);
end;
$$;

-- Put an object in a collection (or take it out): only an object of the same
-- workspace and service, on which this person is an editor or owner.
create function public.set_collection_item(target_collection uuid, target_object uuid, inside boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection public.object_collections;
  object public.service_objects;
begin
  select * into collection from public.object_collections c where c.id = target_collection;
  if not found or not public.can_manage_collections(collection.workspace_id) then
    return public.page_error('not_found');
  end if;
  select * into object from public.service_objects o
  where o.id = target_object and o.workspace_id = collection.workspace_id and o.service = collection.service and o.deleted_at is null;
  if not found or public.role_rank(public.service_object_role(object.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if inside then
    insert into public.object_collection_items (collection_id, object_id, workspace_id, position)
    values (collection.id, object.id, collection.workspace_id,
            coalesce((select max(i.position) from public.object_collection_items i where i.collection_id = collection.id), 0) + 1)
    on conflict (collection_id, object_id) do nothing;
  else
    delete from public.object_collection_items i where i.collection_id = collection.id and i.object_id = object.id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.can_manage_collections(uuid) from public, anon;
revoke execute on function public.save_object_collection(uuid, uuid, text, text, double precision), public.delete_object_collection(uuid),
  public.set_collection_item(uuid, uuid, boolean) from public, anon;
grant execute on function public.can_manage_collections(uuid), public.save_object_collection(uuid, uuid, text, text, double precision),
  public.delete_object_collection(uuid), public.set_collection_item(uuid, uuid, boolean) to authenticated;
