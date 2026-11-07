-- Workspace roles in a team's own database (as supabase/migrations/20261221100000_workspace_roles.sql);
-- here they only arrive from the central copy.
-- Rollback: supabase/team/rollbacks/0036_workspace_roles.down.sql

-- Company structure, stage 2: workspace roles with their own names. The built-in
-- "admin" and "member" rows only carry a name (and, for members, their rights);
-- owner, admin and guest stay what they are. A member may get a custom role:
-- rights in the workspace and a ceiling for what is open to the whole workspace.

create table public.workspace_roles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  builtin       text check (builtin in ('admin', 'member')),
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  -- {"create_pages": true, "create_projects": false, ...}
  permissions   jsonb not null default '{}' check (jsonb_typeof(permissions) = 'object'),
  -- The most a holder gets on what is open to the whole workspace; null: no ceiling.
  content_level text check (content_level in ('viewer', 'commenter', 'editor')),
  position      double precision not null default 0,
  created_at    timestamptz not null default now()
);
create unique index workspace_roles_builtin_idx on public.workspace_roles (workspace_id, builtin) where builtin is not null;
create index workspace_roles_ws_idx on public.workspace_roles (workspace_id, position);

alter table public.workspace_roles enable row level security;
revoke all on public.workspace_roles from public, anon, authenticated;
grant select on public.workspace_roles to authenticated;
create policy "Members read their workspace's roles"
  on public.workspace_roles for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Here roles only arrive from the central copy (no foreign key: they may come after members).
alter table public.workspace_members add column custom_role_id uuid;

-- Rights a member's role gives (defaults: what members could do before roles).
create function public.role_permission_default(perm text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select perm in ('create_pages', 'create_objects', 'manage_collections');
$$;

-- May the signed-in person do this in the workspace? Owners and admins always,
-- guests never through a role, members as their role (or the built-in member row) says.
create function public.role_allows(ws uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role in ('owner', 'admin') then true
      when m.role = 'guest' then false
      else coalesce(
        (select (r.permissions ->> perm)::boolean from public.workspace_roles r where r.id = m.custom_role_id and r.workspace_id = ws),
        (select (r.permissions ->> perm)::boolean from public.workspace_roles r where r.workspace_id = ws and r.builtin = 'member'),
        public.role_permission_default(perm))
    end
    from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.status = 'active'
  ), false);
$$;

-- What is open to the whole workspace, no higher than the member's role allows.
create function public.capped_role(ws uuid, member uuid, granted text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with ceiling as (
    select case when m.role = 'member' then coalesce(
      (select r.content_level from public.workspace_roles r where r.id = m.custom_role_id and r.workspace_id = ws),
      (select r.content_level from public.workspace_roles r where r.workspace_id = ws and r.builtin = 'member'))
    end as level
    from public.workspace_members m where m.workspace_id = ws and m.user_id = member
  )
  select case
    when granted is null then null
    when (select level from ceiling) is null then granted
    when public.role_rank(granted) <= public.role_rank((select level from ceiling)) then granted
    else (select level from ceiling)
  end;
$$;

revoke execute on function public.role_allows(uuid, text), public.capped_role(uuid, uuid, text) from public, anon;
grant execute on function public.role_allows(uuid, text), public.capped_role(uuid, uuid, text) to authenticated;


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
  guest as (
    select public.is_guest((select p.workspace_id from public.pages p where p.id = target_page), member) as yes
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = member
    union all
    select public.capped_role((select p.workspace_id from public.pages p where p.id = target_page), member, c.workspace_role) from chain c where c.workspace_role is not null and not (select g.yes from guest g)
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = member
    union all
    select ga.role from chain c
    join public.page_group_access ga on ga.page_id = c.id
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    where not (select g.yes from guest g)
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;

create or replace function public.task_project_role_of(target_project uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with project as (select * from public.task_projects p where p.id = target_project),
  guest as (select public.is_guest((select p.workspace_id from project p), member) as yes),
  candidates as (
    select 'owner' as role from project p
    join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select public.capped_role(p.workspace_id, member, p.workspace_role) from project p, guest g
    where p.workspace_role is not null and not g.yes and public.is_active_member(p.workspace_id, member)
    union all
    select case when g.yes and a.role = 'owner' then 'editor' else a.role end
    from public.task_project_access a, guest g where a.project_id = target_project and a.user_id = member
    union all
    select ga.role from public.task_project_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    cross join guest g
    where ga.project_id = target_project and not g.yes
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

create or replace function public.service_object_role_of(target_object uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with object as (select * from public.service_objects o where o.id = target_object),
  guest as (select public.is_guest((select o.workspace_id from object o), member) as yes),
  candidates as (
    select 'owner' as role from object o where o.owner_id = member and public.is_active_member(o.workspace_id, member)
    union all
    select 'owner' from object o
    join public.workspace_members m on m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select public.capped_role(o.workspace_id, member, o.workspace_role) from object o, guest g
    where o.workspace_role is not null and not g.yes and public.is_active_member(o.workspace_id, member)
    union all
    select case when g.yes and a.role = 'owner' then 'editor' else a.role end
    from public.service_object_access a, guest g where a.object_id = target_object and a.user_id = member
    union all
    select ga.role from public.service_object_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    cross join guest g
    where ga.object_id = target_object and not g.yes
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

create or replace function public.create_page(ws uuid, parent uuid, new_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- Custom roles (company structure, stage 2) may take this right away; guests keep their own rules.
  if not guest and not public.role_allows(ws, 'create_pages') then
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
  values (ws, parent, case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(),
          trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;
  -- A guest's page belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    values (ws, new_id, auth.uid(), 'editor', auth.uid());
  end if;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.create_page_at(ws uuid, parent uuid, new_title text, page_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if page_id is null then
    return public.page_error('invalid');
  end if;
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- Custom roles (company structure, stage 2) may take this right away; guests keep their own rules.
  if not guest and not public.role_allows(ws, 'create_pages') then
    return public.page_error('forbidden');
  end if;
  -- A retry of the same request (the browser already shows this page): the same answer again.
  if exists (select 1 from public.pages p where p.id = page_id) then
    if exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = ws and p.created_by = auth.uid()) then
      return jsonb_build_object('ok', true, 'id', page_id);
    end if;
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

  insert into public.pages (id, workspace_id, parent_id, owner_id, created_by, title, updated_by)
  values (page_id, ws, parent, case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(),
          trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;
  -- A guest's page belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    values (ws, new_id, auth.uid(), 'editor', auth.uid());
  end if;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- Custom roles (company structure, stage 2) may take this right away; guests keep their own rules.
  if not guest and not public.role_allows(ws, 'create_objects') then
    return public.page_error('forbidden');
  end if;

  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind = 'board')
          or (target_service = 'sheets' and new_kind = 'sheet') or (target_service = 'surveys' and new_kind = 'survey')) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;
  if pg_column_size(coalesce(new_data, '{}'::jsonb)) > 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.service_objects o where o.workspace_id = ws and o.deleted_at is null) >= 5000 then
    return public.page_error('too_many');
  end if;
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by, workspace_role)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(), auth.uid(),
          case when target_service = 'surveys' then 'viewer' else 'editor' end)
  returning id into new_id;
  -- A guest's map or board belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
    values (new_id, ws, auth.uid(), 'editor', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

create or replace function public.create_task_project(ws uuid, new_name text, new_key text, new_icon text, status_names text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_key text := upper(btrim(coalesce(new_key, '')));
  project_id uuid;
  names text[] := coalesce(status_names, array['To do', 'In progress', 'Done']);
begin
  if not public.is_workspace_member(ws) or not public.role_allows(ws, 'create_projects') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 then
    return public.page_error('invalid_name');
  end if;
  if clean_key !~ '^[A-Z][A-Z0-9]{1,9}$' then
    return public.page_error('invalid_key');
  end if;
  if exists (select 1 from public.task_projects p where p.workspace_id = ws and p.key = clean_key) then
    return public.page_error('key_taken');
  end if;
  if cardinality(names) <> 3 then
    return public.page_error('invalid');
  end if;
  insert into public.task_projects (workspace_id, key, name, icon, created_by)
  values (ws, clean_key, btrim(new_name), nullif(btrim(coalesce(new_icon, '')), ''), auth.uid())
  returning id into project_id;
  insert into public.task_statuses (project_id, workspace_id, name, category, position) values
    (project_id, ws, names[1], 'todo', 1),
    (project_id, ws, names[2], 'doing', 2),
    (project_id, ws, names[3], 'done', 3);
  return jsonb_build_object('ok', true, 'id', project_id, 'key', clean_key);
end;
$$;

create or replace function public.save_task_field(target_project uuid, field_id uuid, definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  kinds text[] := array['text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person'];
  new_kind text := definition ->> 'kind';
  new_options jsonb := coalesce(definition -> 'options', '[]'::jsonb);
  types text[];
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner'
     and not (public.task_project_role(target_project) is not null
              and public.role_allows((select p.workspace_id from public.task_projects p where p.id = target_project), 'manage_fields')) then
    return public.page_error('forbidden');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if char_length(btrim(coalesce(definition ->> 'name', ''))) not between 1 and 60 then
    return public.page_error('invalid_name');
  end if;
  if field_id is null and not (new_kind = any (kinds)) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(definition ->> 'hint', '')) > 300 then
    return public.page_error('invalid');
  end if;
  if jsonb_typeof(new_options) <> 'array' or jsonb_array_length(new_options) > 100 or exists (
    select 1 from jsonb_array_elements(new_options) o
    where coalesce(o ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,40}$'
       or char_length(btrim(coalesce(o ->> 'label', ''))) not between 1 and 60
       or (o ? 'color' and o ->> 'color' is not null and (o ->> 'color') !~* '^#[0-9a-f]{6}$')
  ) or (select count(distinct o ->> 'id') from jsonb_array_elements(new_options) o) <> jsonb_array_length(new_options) then
    return public.page_error('invalid_options');
  end if;
  if definition ? 'task_types' and jsonb_typeof(definition -> 'task_types') = 'array' then
    types := array(select jsonb_array_elements_text(definition -> 'task_types'));
    if not types <@ array['task', 'bug', 'idea', 'epic'] then
      return public.page_error('invalid');
    end if;
    if cardinality(types) = 0 then
      types := null;
    end if;
  end if;
  if field_id is null then
    if (select count(*) from public.task_fields f where f.project_id = target_project) >= 50 then
      return public.page_error('too_many_fields');
    end if;
    insert into public.task_fields (project_id, workspace_id, name, kind, options, required, task_types, position, hint)
    values (target_project, ws, btrim(definition ->> 'name'), new_kind, new_options, coalesce((definition ->> 'required')::boolean, false), types,
            coalesce((select max(f.position) from public.task_fields f where f.project_id = target_project), 0) + 1,
            nullif(btrim(coalesce(definition ->> 'hint', '')), ''))
    returning id into saved;
  else
    -- The kind stays: the values already given are of that kind.
    update public.task_fields set
      name = btrim(definition ->> 'name'),
      options = new_options,
      required = coalesce((definition ->> 'required')::boolean, required),
      task_types = case when definition ? 'task_types' then types else task_types end,
      position = coalesce((definition ->> 'position')::double precision, position),
      hint = case when definition ? 'hint' then nullif(btrim(coalesce(definition ->> 'hint', '')), '') else hint end
    where id = field_id and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

create or replace function public.delete_task_field(target_field uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field public.task_fields;
begin
  select * into field from public.task_fields where id = target_field;
  if not found or (coalesce(public.task_project_role(field.project_id), '') <> 'owner'
                   and not (public.task_project_role(field.project_id) is not null and public.role_allows(field.workspace_id, 'manage_fields'))) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_fields where id = target_field;
  update public.tasks set custom = custom - target_field::text where project_id = field.project_id and custom ? target_field::text;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.can_manage_collections(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid()) and public.role_allows(ws, 'manage_collections');
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
    insert into public.workspace_members (workspace_id, user_id, role, joined_via, status, joined_at, profile_visibility, access_until, custom_role_id)
    select ws_id, (m ->> 'user_id')::uuid, m ->> 'role', coalesce(m ->> 'joined_via', 'invite'), 'active',
           coalesce((m ->> 'joined_at')::timestamptz, now()), coalesce(m ->> 'profile_visibility', 'private'),
           (m ->> 'access_until')::timestamptz, (m ->> 'custom_role_id')::uuid
    from jsonb_array_elements(payload -> 'members') m
    on conflict (workspace_id, user_id) do update set role = excluded.role, joined_via = excluded.joined_via,
      status = 'active', profile_visibility = excluded.profile_visibility, access_until = excluded.access_until,
      custom_role_id = excluded.custom_role_id;
    update public.workspace_members m set status = 'removed'
    where m.workspace_id = ws_id and m.status = 'active'
      and not exists (select 1 from jsonb_array_elements(payload -> 'members') x where (x ->> 'user_id')::uuid = m.user_id);
  end if;

  -- Guests own nothing here: what they made passes to the workspace owner.
  if payload ? 'members' then
    perform public.hand_guest_content_to_owner(ws_id, m.user_id)
    from public.workspace_members m
    where m.workspace_id = ws_id and m.status = 'active' and m.role = 'guest'
      and (exists (select 1 from public.pages p where p.workspace_id = ws_id and p.owner_id = m.user_id)
        or exists (select 1 from public.service_objects o where o.workspace_id = ws_id and o.owner_id = m.user_id));
  end if;

  if payload ? 'roles' then
    -- Workspace roles as they are centrally.
    delete from public.workspace_roles r
    where r.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(payload -> 'roles') x where (x ->> 'id')::uuid = r.id);
    insert into public.workspace_roles (id, workspace_id, builtin, name, permissions, content_level, position)
    select (x ->> 'id')::uuid, ws_id, x ->> 'builtin', x ->> 'name', coalesce(x -> 'permissions', '{}'::jsonb), x ->> 'content_level',
           coalesce((x ->> 'position')::double precision, 0)
    from jsonb_array_elements(payload -> 'roles') x
    on conflict (id) do update set builtin = excluded.builtin, name = excluded.name, permissions = excluded.permissions,
      content_level = excluded.content_level, position = excluded.position;
  end if;

  if payload ? 'groups' then
    -- Groups as they are centrally; a group gone there takes its page grants here with it.
    delete from public.workspace_groups g
    where g.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(payload -> 'groups') x where (x ->> 'id')::uuid = g.id);
    insert into public.workspace_groups (id, workspace_id, name, position, created_at)
    select (x ->> 'id')::uuid, ws_id, x ->> 'name', coalesce((x ->> 'position')::double precision, 0), coalesce((x ->> 'created_at')::timestamptz, now())
    from jsonb_array_elements(payload -> 'groups') x
    on conflict (id) do update set name = excluded.name, position = excluded.position;
    -- Parents after every unit is there (a parent may come later in the list).
    update public.workspace_groups g set parent_id = (x ->> 'parent_id')::uuid
    from jsonb_array_elements(payload -> 'groups') x
    where g.id = (x ->> 'id')::uuid and g.parent_id is distinct from (x ->> 'parent_id')::uuid;
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
    private_tasks_admin = coalesce((payload -> 'settings' ->> 'private_tasks_admin')::boolean, private_tasks_admin),
    updated_at = now()
  -- Supabase refuses an UPDATE without WHERE coming through its API.
  where id;
  return jsonb_build_object('ok', true);
end;
$$;
