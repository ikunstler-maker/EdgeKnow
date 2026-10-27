-- Stage 5: page access. Per-person grants, "whole workspace" access, inheritance
-- from the parent page (as in Notion) and ownership transfer.
--
-- Access is still resolved in one place, public.effective_role(page): every policy and
-- page function built on it (pages, attachments, storage, content saving) picks up the
-- new roles without changes.
-- Rollback: supabase/rollbacks/20261101100000_page_access.down.sql

-------------------------------------------------------------------------------
-- Columns and table
-------------------------------------------------------------------------------

alter table public.pages
  -- false = "Обмежити доступ": the page no longer follows its parent's access list.
  add column inherit boolean not null default true,
  -- Access for every member of the workspace; null = none.
  add column workspace_role text check (workspace_role in ('editor', 'commenter', 'viewer'));

create table public.page_access (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (page_id, user_id)
);

create index page_access_user_idx on public.page_access (workspace_id, user_id);

alter table public.page_access enable row level security;
revoke all on public.page_access from anon;
revoke insert, update, delete, truncate on public.page_access from authenticated;

-- A grant always lives in its page's workspace.
create function public.check_page_access_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select p.workspace_id from public.pages p where p.id = new.page_id) then
    raise exception 'grant and page must be in the same workspace';
  end if;
  return new;
end;
$$;

create trigger page_access_same_workspace
  before insert or update on public.page_access
  for each row execute function public.check_page_access_workspace();

-- Someone who leaves a workspace loses their grants there (rejoining starts clean).
create function public.drop_grants_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.page_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger workspace_members_drop_grants
  after update of status on public.workspace_members
  for each row execute function public.drop_grants_of_removed_member();

-------------------------------------------------------------------------------
-- Access
-------------------------------------------------------------------------------

create function public.role_rank(page_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case page_role when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end;
$$;

-- The page and the ancestors it inherits from: walking up stops after a page
-- with inherit = false (its own list is final).
create function public.access_chain(target_page uuid)
returns table (id uuid, depth integer, owner_id uuid, workspace_role text)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select p.id, p.parent_id, p.inherit, p.owner_id, p.workspace_role, 0 as depth
    from public.pages p
    where p.id = target_page
    union all
    select pp.id, pp.parent_id, pp.inherit, pp.owner_id, pp.workspace_role, c.depth + 1
    from chain c
    join public.pages pp on pp.id = c.parent_id
    where c.inherit and c.depth < 100
  )
  select chain.id, chain.depth, chain.owner_id, chain.workspace_role from chain;
$$;

-- Role of the current user: 'owner' | 'editor' | 'commenter' | 'viewer' | null.
-- Membership of the page's workspace is checked first; then the highest of: owning the
-- page, owning a page it inherits from (editor), whole-workspace access and personal
-- grants along the chain.
create or replace function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with chain as (
    select c.*
    from public.pages p
    cross join lateral public.access_chain(p.id) c
    where p.id = target_page and public.is_workspace_member(p.workspace_id)
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = auth.uid()
    union all
    select c.workspace_role from chain c where c.workspace_role is not null
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = auth.uid()
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;

-- Same as effective_role, for PostgREST's computed field `my_role` on pages.
create function public.my_role(page public.pages)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_role(page.id);
$$;

-- Whole-workspace access the page has, own or inherited (computed field on pages).
create function public.shared_with_workspace(page public.pages)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.workspace_role
  from public.access_chain(page.id) c
  where public.is_workspace_member(page.workspace_id) and c.workspace_role is not null
  order by public.role_rank(c.workspace_role) desc
  limit 1;
$$;

-- True when `member` is an active member of the workspace (grants go only to them).
create function public.is_active_member(ws uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = member and m.status = 'active'
  );
$$;

-------------------------------------------------------------------------------
-- Sharing info for the "Поділитися" dialog
-------------------------------------------------------------------------------

-- Everyone with a role sees who has access; only the owner also gets the member list
-- for adding people. Inherited entries name the page they come from only if the
-- caller can see that page.
create function public.page_sharing(target_page uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  my text := public.effective_role(target_page);
  page public.pages;
  inherited_ws text;
  entries jsonb;
  members jsonb := '[]'::jsonb;
begin
  if my is null then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;

  select c.workspace_role into inherited_ws
  from public.access_chain(target_page) c
  where c.depth > 0 and c.workspace_role is not null
  order by public.role_rank(c.workspace_role) desc
  limit 1;

  with sources as (
    select a.user_id, a.role, c.depth, c.id as from_page
    from public.access_chain(target_page) c
    join public.page_access a on a.page_id = c.id
    union all
    select c.owner_id, 'editor', c.depth, c.id
    from public.access_chain(target_page) c
    where c.depth > 0
  ),
  best as (
    -- One line per person: their highest role; their own grant wins a tie.
    select distinct on (s.user_id) s.user_id, s.role, s.depth, s.from_page
    from sources s
    where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
    order by s.user_id, public.role_rank(s.role) desc, s.depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', b.user_id,
      'name', pr.name,
      'email', pr.email,
      'role', b.role,
      'own', exists (select 1 from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'own_role', (select a.role from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'inherited_from', case when b.depth > 0 then b.from_page end,
      'inherited_title', case
        when b.depth > 0 and public.effective_role(b.from_page) is not null
        then (select f.title from public.pages f where f.id = b.from_page)
      end
    ) order by pr.name nulls last, pr.email), '[]'::jsonb)
    into entries
  from best b
  join public.profiles pr on pr.id = b.user_id;

  if my = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email), '[]'::jsonb)
      into members
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = page.workspace_id and m.status = 'active' and m.user_id <> page.owner_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'my_role', my,
    'owner', (select jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
              from public.profiles pr where pr.id = page.owner_id),
    'has_parent', page.parent_id is not null,
    'inherit', page.inherit,
    'workspace_role', page.workspace_role,
    'inherited_workspace_role', case when page.parent_id is not null and page.inherit then inherited_ws end,
    'entries', entries,
    'members', members
  );
end;
$$;

-------------------------------------------------------------------------------
-- Changing access (page owner only). All return {"ok": true} or {"ok": false, "error": "<code>"}.
-------------------------------------------------------------------------------

-- new_role = null removes the person's own grant (inherited access stays).
create function public.set_page_member_role(target_page uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page public.pages;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if member = page.owner_id then
    return public.page_error('is_owner');
  end if;

  if new_role is null then
    delete from public.page_access where page_id = target_page and user_id = member;
    return jsonb_build_object('ok', true);
  end if;

  -- Only people of the same workspace; someone from another one is "not found".
  if not public.is_active_member(page.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;

  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  values (page.workspace_id, target_page, member, new_role, auth.uid())
  on conflict (page_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_page_workspace_role(target_page uuid, new_role text)
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
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.pages set workspace_role = new_role where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

-- Restricting (inherit = false) copies what the page inherited into its own list, so
-- nobody loses access by surprise; the owner then removes whom they want. Turning
-- inheritance back on keeps the own list, which adds to the inherited one.
create function public.set_page_inherit(target_page uuid, new_inherit boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page public.pages;
  inherited_ws text;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if page.parent_id is null then
    return public.page_error('no_parent');
  end if;
  if page.inherit = new_inherit then
    return jsonb_build_object('ok', true);
  end if;

  if not new_inherit then
    with sources as (
      select a.user_id, a.role from public.access_chain(target_page) c
      join public.page_access a on a.page_id = c.id
      where c.depth > 0
      union all
      select c.owner_id, 'editor' from public.access_chain(target_page) c where c.depth > 0
    ),
    best as (
      select distinct on (s.user_id) s.user_id, s.role
      from sources s
      where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
      order by s.user_id, public.role_rank(s.role) desc
    )
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    select page.workspace_id, target_page, b.user_id, b.role, auth.uid() from best b
    on conflict (page_id, user_id) do update
      set role = case when public.role_rank(excluded.role) > public.role_rank(public.page_access.role)
                      then excluded.role else public.page_access.role end;

    select c.workspace_role into inherited_ws
    from public.access_chain(target_page) c
    where c.workspace_role is not null
    order by public.role_rank(c.workspace_role) desc
    limit 1;
    update public.pages set inherit = false, workspace_role = inherited_ws where id = target_page;
  else
    update public.pages set inherit = true where id = target_page;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The old owner stays on the page as an editor.
create function public.transfer_page_ownership(target_page uuid, new_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page public.pages;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if new_owner = page.owner_id then
    return jsonb_build_object('ok', true);
  end if;
  if not public.is_active_member(page.workspace_id, new_owner) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access where page_id = target_page and user_id = new_owner;
  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  values (page.workspace_id, target_page, page.owner_id, 'editor', auth.uid())
  on conflict (page_id, user_id) do update set role = 'editor';
  update public.pages set owner_id = new_owner where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Pages of people who left (workspace owner and admins)
-------------------------------------------------------------------------------

-- Admins don't see the pages themselves, only how many each former member left behind.
create function public.departed_page_owners(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'owners', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', x.name, 'email', x.email, 'pages', x.pages)
             order by x.email)
    from (
      select p.owner_id, pr.name, pr.email, count(*) as pages
      from public.pages p
      join public.profiles pr on pr.id = p.owner_id
      where p.workspace_id = ws and not public.is_active_member(ws, p.owner_id)
      group by p.owner_id, pr.name, pr.email
    ) x
  ), '[]'::jsonb));
end;
$$;

-- Gives every page of a former member to an active one. Logged; refusals too.
create function public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'reassign_member_pages'));
    return public.page_error('forbidden');
  end if;
  if public.is_active_member(ws, from_user) then
    return public.page_error('still_a_member');
  end if;
  if not public.is_active_member(ws, to_user) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access a
  using public.pages p
  where a.page_id = p.id and p.workspace_id = ws and p.owner_id = from_user and a.user_id = to_user;
  update public.pages set owner_id = to_user where workspace_id = ws and owner_id = from_user;
  get diagnostics moved = row_count;
  perform public.log_workspace_action(ws, 'pages_reassigned', jsonb_build_object(
    'from', (select email from public.profiles where id = from_user),
    'to', (select email from public.profiles where id = to_user),
    'pages', moved));
  return jsonb_build_object('ok', true, 'pages', moved);
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.check_page_access_workspace(),
  public.drop_grants_of_removed_member(),
  public.role_rank(text),
  public.access_chain(uuid),
  public.my_role(public.pages),
  public.shared_with_workspace(public.pages),
  public.is_active_member(uuid, uuid),
  public.page_sharing(uuid),
  public.set_page_member_role(uuid, uuid, text),
  public.set_page_workspace_role(uuid, text),
  public.set_page_inherit(uuid, boolean),
  public.transfer_page_ownership(uuid, uuid),
  public.departed_page_owners(uuid),
  public.reassign_member_pages(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.my_role(public.pages),
  public.shared_with_workspace(public.pages),
  public.page_sharing(uuid),
  public.set_page_member_role(uuid, uuid, text),
  public.set_page_workspace_role(uuid, text),
  public.set_page_inherit(uuid, boolean),
  public.transfer_page_ownership(uuid, uuid),
  public.departed_page_owners(uuid),
  public.reassign_member_pages(uuid, uuid, uuid)
to authenticated;

-------------------------------------------------------------------------------
-- RLS: grants are visible to whoever can see the page (the share dialog lists them).
-------------------------------------------------------------------------------

create policy "Members read grants of pages they can see"
  on public.page_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);
