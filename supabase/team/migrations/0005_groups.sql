-- Groups of people (see supabase/migrations/20261115100000_groups.sql): the
-- same page part as centrally; the groups and who is in them are copies that
-- team_sync keeps up to date (they are managed centrally).
-- Rollback: supabase/team/rollbacks/0005_groups.down.sql

-- Groups of people of a workspace ("Marketing", "Developers").
create table public.workspace_groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index workspace_groups_workspace_idx on public.workspace_groups (workspace_id);

create table public.workspace_group_members (
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index workspace_group_members_user_idx on public.workspace_group_members (user_id);

-- A group's role on a page (and, as for people, on its subpages).
create table public.page_group_access (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  role          text not null check (role in ('editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (page_id, group_id)
);
create index page_group_access_group_idx on public.page_group_access (group_id);

alter table public.workspace_groups enable row level security;
alter table public.workspace_group_members enable row level security;
alter table public.page_group_access enable row level security;
revoke all on public.workspace_groups, public.workspace_group_members, public.page_group_access from public, anon, authenticated;
grant select on public.workspace_groups, public.workspace_group_members, public.page_group_access to authenticated;

create policy "Members read their workspace's groups"
  on public.workspace_groups for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "Members read who is in their workspace's groups"
  on public.workspace_group_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "Members read group grants of pages they can see"
  on public.page_group_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);

-- Everything of one group stays in its workspace.
create function public.check_group_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'workspace_group_members' or tg_table_name = 'page_group_access' then
    if new.workspace_id is distinct from (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) then
      raise exception 'group and grant must be in the same workspace';
    end if;
  end if;
  if tg_table_name = 'page_group_access' then
    -- Nested: the field exists only on this table.
    if new.workspace_id is distinct from (select p.workspace_id from public.pages p where p.id = new.page_id) then
      raise exception 'group grant and page must be in the same workspace';
    end if;
  end if;
  return new;
end;
$$;
create trigger workspace_group_members_same_workspace before insert or update on public.workspace_group_members
  for each row execute function public.check_group_workspace();
create trigger page_group_access_same_workspace before insert or update on public.page_group_access
  for each row execute function public.check_group_workspace();

-- A person's role on a page now also comes from their groups.
create or replace function public.page_role_of(target_page uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with chain as (
    select c.* from public.access_chain(target_page) c
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = member
    union all
    select c.workspace_role from chain c where c.workspace_role is not null
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = member
    union all
    select ga.role from chain c
    join public.page_group_access ga on ga.page_id = c.id
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;

-- Give a group a role on a page (null takes it away). Page owner only, like for people.
create function public.set_page_group_role(target_page uuid, target_group uuid, new_role text)
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
  if new_role is null then
    delete from public.page_group_access where page_id = target_page and group_id = target_group;
    return jsonb_build_object('ok', true);
  end if;
  -- A group of another workspace is "not found".
  if not exists (select 1 from public.workspace_groups g where g.id = target_group and g.workspace_id = page.workspace_id) then
    return public.page_error('not_found');
  end if;
  insert into public.page_group_access (workspace_id, page_id, group_id, role, granted_by)
  values (page.workspace_id, target_page, target_group, new_role, auth.uid())
  on conflict (page_id, group_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_page_group_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_page_group_role(uuid, uuid, text) to authenticated;

-- The sharing dialog: people as before, plus the groups with a role here and
-- (for the owner) all groups to choose from.
create or replace function public.page_sharing(target_page uuid)
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
  group_entries jsonb;
  members jsonb := '[]'::jsonb;
  all_groups jsonb := '[]'::jsonb;
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

  with sources as (
    select ga.group_id, ga.role, c.depth, c.id as from_page
    from public.access_chain(target_page) c
    join public.page_group_access ga on ga.page_id = c.id
  ),
  best as (
    select distinct on (s.group_id) s.group_id, s.role, s.depth, s.from_page
    from sources s
    order by s.group_id, public.role_rank(s.role) desc, s.depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'group_id', b.group_id,
      'name', g.name,
      'members', (select count(*) from public.workspace_group_members gm where gm.group_id = b.group_id),
      'role', b.role,
      'own', exists (select 1 from public.page_group_access a where a.page_id = target_page and a.group_id = b.group_id),
      'own_role', (select a.role from public.page_group_access a where a.page_id = target_page and a.group_id = b.group_id),
      'inherited_from', case when b.depth > 0 then b.from_page end,
      'inherited_title', case
        when b.depth > 0 and public.effective_role(b.from_page) is not null
        then (select f.title from public.pages f where f.id = b.from_page)
      end
    ) order by g.name), '[]'::jsonb)
    into group_entries
  from best b
  join public.workspace_groups g on g.id = b.group_id;

  if my = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email), '[]'::jsonb)
      into members
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = page.workspace_id and m.status = 'active' and m.user_id <> page.owner_id;
    select coalesce(jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name,
             'members', (select count(*) from public.workspace_group_members gm where gm.group_id = g.id))
             order by g.name), '[]'::jsonb)
      into all_groups
    from public.workspace_groups g
    where g.workspace_id = page.workspace_id;
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
    'members', members,
    'groups', group_entries,
    'all_groups', all_groups
  );
end;
$$;

-- Breaking inheritance keeps what groups had from above, as it does for people.
create or replace function public.set_page_inherit(target_page uuid, new_inherit boolean)
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

    with best as (
      select distinct on (ga.group_id) ga.group_id, ga.role
      from public.access_chain(target_page) c
      join public.page_group_access ga on ga.page_id = c.id
      where c.depth > 0
      order by ga.group_id, public.role_rank(ga.role) desc
    )
    insert into public.page_group_access (workspace_id, page_id, group_id, role, granted_by)
    select page.workspace_id, target_page, b.group_id, b.role, auth.uid() from best b
    on conflict (page_id, group_id) do update
      set role = case when public.role_rank(excluded.role) > public.role_rank(public.page_group_access.role)
                      then excluded.role else public.page_group_access.role end;

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

-- Someone who leaves the workspace leaves its groups too.
create or replace function public.drop_grants_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.page_access where workspace_id = new.workspace_id and user_id = new.user_id;
    delete from public.workspace_group_members where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create or replace function public.team_sync(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws jsonb := payload -> 'workspace';
  ws_id uuid := (ws ->> 'id')::uuid;
begin
  if ws_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if exists (select 1 from public.workspaces w where w.id <> ws_id) then
    -- A team database belongs to exactly one workspace.
    return jsonb_build_object('ok', false, 'error', 'other_workspace');
  end if;

  insert into public.profiles (id, email, name, avatar_url)
  select (p ->> 'id')::uuid, p ->> 'email', p ->> 'name', p ->> 'avatar_url'
  from jsonb_array_elements(coalesce(payload -> 'profiles', '[]')) p
  on conflict (id) do update set email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url;

  insert into public.workspaces (id, short_id, name, owner_id, created_by, storage_limit_mb, created_at)
  values (ws_id, ws ->> 'short_id', ws ->> 'name', (ws ->> 'owner_id')::uuid, (ws ->> 'owner_id')::uuid,
          coalesce((ws ->> 'storage_limit_mb')::integer, 50), coalesce((ws ->> 'created_at')::timestamptz, now()))
  on conflict (id) do update set short_id = excluded.short_id, name = excluded.name,
    owner_id = excluded.owner_id, storage_limit_mb = excluded.storage_limit_mb;

  if payload ? 'members' then
    -- The owner changes hands without two owners at once.
    update public.workspace_members m set role = 'admin'
    where m.workspace_id = ws_id and m.role = 'owner'
      and m.user_id is distinct from (ws ->> 'owner_id')::uuid;
    insert into public.workspace_members (workspace_id, user_id, role, joined_via, status, joined_at, profile_visibility)
    select ws_id, (m ->> 'user_id')::uuid, m ->> 'role', coalesce(m ->> 'joined_via', 'invite'), 'active',
           coalesce((m ->> 'joined_at')::timestamptz, now()), coalesce(m ->> 'profile_visibility', 'private')
    from jsonb_array_elements(payload -> 'members') m
    on conflict (workspace_id, user_id) do update set role = excluded.role, joined_via = excluded.joined_via,
      status = 'active', profile_visibility = excluded.profile_visibility;
    update public.workspace_members m set status = 'removed'
    where m.workspace_id = ws_id and m.status = 'active'
      and not exists (select 1 from jsonb_array_elements(payload -> 'members') x where (x ->> 'user_id')::uuid = m.user_id);
  end if;

  if payload ? 'groups' then
    -- Groups as they are centrally; a group gone there takes its page grants here with it.
    delete from public.workspace_groups g
    where g.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(payload -> 'groups') x where (x ->> 'id')::uuid = g.id);
    insert into public.workspace_groups (id, workspace_id, name, created_at)
    select (x ->> 'id')::uuid, ws_id, x ->> 'name', coalesce((x ->> 'created_at')::timestamptz, now())
    from jsonb_array_elements(payload -> 'groups') x
    on conflict (id) do update set name = excluded.name;
    delete from public.workspace_group_members gm
    where gm.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'group_members', '[]')) x
                      where (x ->> 'group_id')::uuid = gm.group_id and (x ->> 'user_id')::uuid = gm.user_id);
    insert into public.workspace_group_members (group_id, workspace_id, user_id)
    select (x ->> 'group_id')::uuid, ws_id, (x ->> 'user_id')::uuid
    from jsonb_array_elements(coalesce(payload -> 'group_members', '[]')) x
    on conflict (group_id, user_id) do nothing;
  end if;

  update public.team_settings set
    workspace_id = ws_id,
    issuer = coalesce(payload -> 'settings' ->> 'issuer', issuer),
    files_on_drive = coalesce((payload -> 'settings' ->> 'files_on_drive')::boolean, files_on_drive),
    updated_at = now()
  -- Supabase refuses an UPDATE without WHERE coming through its API.
  where id;
  return jsonb_build_object('ok', true);
end;
$$;
