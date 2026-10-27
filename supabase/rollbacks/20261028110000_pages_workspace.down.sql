-- Undo 20261028110000_pages_workspace.sql: pages without workspaces (stage 2 functions).

drop policy if exists "Members can read pages they have a role on" on public.pages;
drop trigger if exists pages_same_workspace on public.pages;
drop function if exists public.check_page_workspace();
drop function if exists public.create_page(uuid, uuid, text);

create or replace function public.effective_role(target_page uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_allowed_user() then null
    when exists (
      select 1 from public.pages p where p.id = target_page and p.owner_id = auth.uid()
    ) then 'owner'
  end;
$$;

create or replace function public.place_page(moved uuid, new_parent uuid, new_index integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sibling uuid;
  ordered uuid[];
  i integer := 0;
begin
  select coalesce(array_agg(p.id order by p.position, p.created_at), '{}') into ordered
  from public.pages p
  where p.parent_id is not distinct from new_parent and p.deleted_at is null and p.id <> moved
    and (new_parent is not null or p.owner_id = auth.uid());
  new_index := greatest(0, least(coalesce(new_index, cardinality(ordered)), cardinality(ordered)));
  ordered := ordered[1:new_index] || moved || ordered[new_index + 1:];
  foreach sibling in array ordered loop
    update public.pages set position = i where id = sibling and position is distinct from i;
    i := i + 1;
  end loop;
  update public.pages set parent_id = new_parent where id = moved;
end;
$$;

create or replace function public.create_page(parent uuid default null, new_title text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  if not public.is_allowed_user() then return public.page_error('forbidden'); end if;
  if parent is not null then
    if not public.can_edit_page(parent) then return public.page_error('forbidden'); end if;
    if exists (select 1 from public.pages where id = parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
  end if;
  if char_length(coalesce(new_title, '')) > 200 then return public.page_error('title_too_long'); end if;
  insert into public.pages (parent_id, owner_id, title, updated_by)
  values (parent, auth.uid(), trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;
  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.move_page(target_page uuid, new_parent uuid, new_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_page(target_page) then return public.page_error('forbidden'); end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if new_parent is not null then
    if not public.can_edit_page(new_parent) then return public.page_error('forbidden'); end if;
    if exists (select 1 from public.pages where id = new_parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
    if new_parent in (select id from public.page_subtree(target_page)) then
      return public.page_error('cycle');
    end if;
  end if;
  perform public.place_page(target_page, new_parent, new_index);
  update public.pages set updated_at = now(), updated_by = auth.uid() where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

drop index if exists public.pages_workspace_parent_idx;
drop index if exists public.pages_workspace_owner_idx;
alter table public.pages drop column workspace_id, drop column created_by;
create index pages_parent_idx on public.pages (parent_id, position);

create policy "Users can read pages they have a role on"
  on public.pages for select to authenticated
  using (public.effective_role(id) is not null);
