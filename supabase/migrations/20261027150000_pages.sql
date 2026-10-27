-- Stage 2: pages tree, trash with 30-day auto-purge.
--
-- Access is resolved in one place, public.effective_role(page_id). In stage 2 it only
-- knows owners; stage 5 extends it with page_access, company-wide access and inheritance
-- without touching the policies or functions below.

-------------------------------------------------------------------------------
-- Table
-------------------------------------------------------------------------------

create table public.pages (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.pages (id) on delete cascade,
  owner_id      uuid not null references public.profiles (id) on delete restrict,
  title         text not null default '' check (char_length(title) <= 200),
  icon          text check (icon is null or char_length(icon) between 1 and 16),
  position      integer not null default 0,
  content       jsonb,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  -- Trash: every page of a trashed subtree gets deleted_at; trashed_with points at the
  -- page the user actually deleted (the "trash root"), so restoring it brings back exactly
  -- that subtree and nothing that was trashed separately before.
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id) on delete set null,
  trashed_with  uuid,
  check ((deleted_at is null) = (trashed_with is null)),
  check (parent_id is distinct from id)
);

create index pages_parent_idx on public.pages (parent_id, position);
create index pages_owner_idx on public.pages (owner_id);
create index pages_trashed_with_idx on public.pages (trashed_with) where trashed_with is not null;

alter table public.pages enable row level security;

revoke all on public.pages from anon;
revoke insert, update, delete, truncate on public.pages from authenticated;

-------------------------------------------------------------------------------
-- Access
-------------------------------------------------------------------------------

-- Role of the current user on a page: 'owner' | 'editor' | 'commenter' | 'viewer' | null.
create function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_allowed_user() then null
    when exists (
      select 1 from public.pages p where p.id = target_page and p.owner_id = auth.uid()
    ) then 'owner'
  end;
$$;

create function public.can_edit_page(target_page uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.effective_role(target_page) in ('owner', 'editor'), false);
$$;

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

create function public.page_error(code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'error', code);
$$;

-- Page and all its descendants (including itself).
create function public.page_subtree(root uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select p.id from public.pages p where p.id = root
    union all
    select c.id from public.pages c join tree t on c.parent_id = t.id
  )
  select tree.id from tree;
$$;

-- Puts `moved` at `new_index` among the live children of `new_parent` and renumbers them.
create function public.place_page(moved uuid, new_parent uuid, new_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sibling uuid;
  ordered uuid[];
  i integer := 0;
begin
  select coalesce(array_agg(p.id order by p.position, p.created_at), '{}')
    into ordered
  from public.pages p
  where p.parent_id is not distinct from new_parent
    and p.deleted_at is null
    and p.id <> moved
    -- Top level is personal: each user orders only their own root pages.
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

-------------------------------------------------------------------------------
-- Page actions. All return {"ok": true, ...} or {"ok": false, "error": "<code>"}.
-------------------------------------------------------------------------------

create function public.create_page(parent uuid default null, new_title text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_allowed_user() then
    return public.page_error('forbidden');
  end if;

  if parent is not null then
    if not public.can_edit_page(parent) then
      return public.page_error('forbidden');
    end if;
    if exists (select 1 from public.pages where id = parent and deleted_at is not null) then
      return public.page_error('in_trash');
    end if;
  end if;

  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;

  insert into public.pages (parent_id, owner_id, title, updated_by)
  values (parent, auth.uid(), trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create function public.rename_page(target_page uuid, new_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;

  update public.pages
  set title = trim(coalesce(new_title, '')), updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_page_icon(target_page uuid, new_icon text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(trim(coalesce(new_icon, '')), '');
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) > 16 then
    return public.page_error('invalid_icon');
  end if;

  update public.pages
  set icon = cleaned, updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

-- new_parent = null moves the page to the top level.
create function public.move_page(target_page uuid, new_parent uuid, new_index integer)
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
    if not public.can_edit_page(new_parent) then
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

-- Deleting moves the page with its whole subtree to the trash (owner only).
create function public.trash_page(target_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;

  update public.pages
  set deleted_at = now(), deleted_by = auth.uid(), trashed_with = target_page
  where id in (select id from public.page_subtree(target_page))
    and deleted_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.restore_page(target_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent uuid;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.pages where id = target_page and trashed_with = id) then
    return public.page_error('not_in_trash');
  end if;

  update public.pages
  set deleted_at = null, deleted_by = null, trashed_with = null
  where trashed_with = target_page;

  -- If the former parent is gone to the trash itself, bring the page back at the top level.
  select p.parent_id into parent from public.pages p where p.id = target_page;
  if parent is not null and exists (
    select 1 from public.pages where id = parent and deleted_at is not null
  ) then
    perform public.place_page(target_page, null, null);
  else
    perform public.place_page(target_page, parent, null);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.delete_page_forever(target_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.pages where id = target_page and trashed_with = id) then
    return public.page_error('not_in_trash');
  end if;

  -- Children go with it through ON DELETE CASCADE.
  delete from public.pages where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

-- Each trashed page is purged 30 days after it was deleted. Run daily by pg_cron.
create function public.purge_trash()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.pages
  where trashed_with = id and deleted_at < now() - interval '30 days';
  get diagnostics purged = row_count;
  return purged;
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.effective_role(uuid),
  public.can_edit_page(uuid),
  public.page_error(text),
  public.page_subtree(uuid),
  public.place_page(uuid, uuid, integer),
  public.create_page(uuid, text),
  public.rename_page(uuid, text),
  public.set_page_icon(uuid, text),
  public.move_page(uuid, uuid, integer),
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.delete_page_forever(uuid),
  public.purge_trash()
from public, anon, authenticated;

grant execute on function
  public.effective_role(uuid),
  public.create_page(uuid, text),
  public.rename_page(uuid, text),
  public.set_page_icon(uuid, text),
  public.move_page(uuid, uuid, integer),
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.delete_page_forever(uuid)
to authenticated;

-------------------------------------------------------------------------------
-- RLS
-------------------------------------------------------------------------------

create policy "Users can read pages they have a role on"
  on public.pages for select
  to authenticated
  using (public.effective_role(id) is not null);

-------------------------------------------------------------------------------
-- Daily trash purge. pg_cron exists on Supabase; plain Postgres (CI tests) skips this.
-------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-trash', '17 3 * * *', 'select public.purge_trash()');
  end if;
end;
$$;
