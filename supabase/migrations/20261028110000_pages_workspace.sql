-- Workspaces (M2): every page belongs to a workspace; access starts with membership.
-- Also records the page author separately from the owner (ownership can be transferred).
--
-- Backward compatible: create_page(parent, title) keeps working until drop_legacy.
-- Rollback: supabase/rollbacks/20261028110000_pages_workspace.down.sql

-------------------------------------------------------------------------------
-- Columns: nullable -> fill -> NOT NULL
-------------------------------------------------------------------------------

alter table public.pages
  add column workspace_id uuid references public.workspaces (id) on delete cascade,
  add column created_by uuid references public.profiles (id) on delete set null;

-- Existing pages go to the first workspace (the only one at this point).
update public.pages
set workspace_id = (select id from public.workspaces order by created_at limit 1),
    created_by = owner_id
where workspace_id is null;

alter table public.pages alter column workspace_id set not null;

drop index public.pages_parent_idx;
create index pages_workspace_parent_idx on public.pages (workspace_id, parent_id, position);
create index pages_workspace_owner_idx on public.pages (workspace_id, owner_id);

-- A subpage always lives in its parent's workspace.
create function public.check_page_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and new.workspace_id is distinct from (
    select p.workspace_id from public.pages p where p.id = new.parent_id
  ) then
    raise exception 'page and parent must be in the same workspace';
  end if;
  return new;
end;
$$;

create trigger pages_same_workspace
  before insert or update of parent_id, workspace_id on public.pages
  for each row execute function public.check_page_workspace();

revoke execute on function public.check_page_workspace() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Access: membership first, then the page itself
-------------------------------------------------------------------------------

create or replace function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_workspace_member(p.workspace_id) then null
    when p.owner_id = auth.uid() then 'owner'
  end
  from public.pages p
  where p.id = target_page;
$$;

-- Top-level pages are ordered per person inside each workspace.
create or replace function public.place_page(moved uuid, new_parent uuid, new_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sibling uuid;
  ordered uuid[];
  ws uuid;
  i integer := 0;
begin
  select workspace_id into ws from public.pages where id = moved;

  select coalesce(array_agg(p.id order by p.position, p.created_at), '{}')
    into ordered
  from public.pages p
  where p.workspace_id = ws
    and p.parent_id is not distinct from new_parent
    and p.deleted_at is null
    and p.id <> moved
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

-- New signature: the workspace is explicit for top-level pages.
create function public.create_page(ws uuid, parent uuid, new_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;

  if parent is not null then
    if not public.can_edit_page(parent)
       or (select workspace_id from public.pages where id = parent) <> ws then
      return public.page_error('forbidden');
    end if;
    if exists (select 1 from public.pages where id = parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
  end if;

  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;

  insert into public.pages (workspace_id, parent_id, owner_id, created_by, title, updated_by)
  values (ws, parent, auth.uid(), auth.uid(), trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- Legacy signature used by the pre-workspace app: subpages follow their parent,
-- top-level pages go to the caller's first workspace. Dropped in drop_legacy.
create or replace function public.create_page(parent uuid default null, new_title text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if parent is not null then
    select workspace_id into ws from public.pages where id = parent;
  else
    select m.workspace_id into ws
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    order by w.created_at
    limit 1;
  end if;
  if ws is null then
    return public.page_error('forbidden');
  end if;
  return public.create_page(ws, parent, new_title);
end;
$$;

-- Moves stay inside the page's workspace.
create or replace function public.move_page(target_page uuid, new_parent uuid, new_index integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;

  if new_parent is not null then
    if not public.can_edit_page(new_parent)
       or (select workspace_id from public.pages where id = new_parent)
          <> (select workspace_id from public.pages where id = target_page) then
      return public.page_error('forbidden');
    end if;
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

revoke execute on function public.create_page(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_page(uuid, uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- RLS: rows of other workspaces are filtered before the page role is even computed.
-------------------------------------------------------------------------------

drop policy "Users can read pages they have a role on" on public.pages;
create policy "Members can read pages they have a role on"
  on public.pages for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(id) is not null);
