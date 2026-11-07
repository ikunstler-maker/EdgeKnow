-- Access along the unit tree in a team's own database (as supabase/migrations/20261222100000_unit_access.sql).
-- Rollback: supabase/team/rollbacks/0037_unit_access.down.sql

-- Company structure, stage 3: access follows the tree. What is given to a unit reaches
-- everyone in it and in the units under it (down), and the leads of the units above it
-- (up, leads only). Guests keep their own rules (they get nothing through units).

alter table public.workspace_group_members add column is_lead boolean not null default false;

create function public.unit_reaches(target_group uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive down as (
    select g.id, 0 as level from public.workspace_groups g where g.id = target_group
    union all
    select g.id, d.level + 1 from public.workspace_groups g join down d on g.parent_id = d.id where d.level < 10
  ),
  up as (
    select g.parent_id as id, 1 as level from public.workspace_groups g where g.id = target_group and g.parent_id is not null
    union all
    select g.parent_id, u.level + 1 from public.workspace_groups g join up u on g.id = u.id where g.parent_id is not null and u.level < 10
  )
  select target_group is not null and (
    exists (select 1 from public.workspace_group_members gm where gm.user_id = member and gm.group_id in (select id from down))
    or exists (select 1 from public.workspace_group_members gm where gm.user_id = member and gm.is_lead and gm.group_id in (select id from up))
  );
$$;
revoke execute on function public.unit_reaches(uuid, uuid) from public, anon;
grant execute on function public.unit_reaches(uuid, uuid) to authenticated;

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
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
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
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
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
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
    cross join guest g
    where ga.object_id = target_object and not g.yes
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

create or replace function public.board_visible_to(target_board uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_board is null or exists (
    select 1 from public.task_boards b
    where b.id = target_board
      and (public.task_project_role_of(b.project_id, person) = 'owner'
           or exists (select 1 from public.workspace_members m where m.workspace_id = b.workspace_id and m.user_id = person
                      and m.status = 'active' and m.role in ('owner', 'admin'))
           or (b.group_id is null and not exists (select 1 from public.task_board_access a where a.board_id = b.id))
           -- The team's unit (and units with access) reach down the tree and up to leads.
           or public.unit_reaches(b.group_id, person)
           or exists (select 1 from public.task_board_access a where a.board_id = b.id and public.unit_reaches(a.group_id, person))));
$$;

create or replace function public.notify_rule(rule public.task_rules, task public.tasks, what text, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
begin
  for person in
    select unnest(rule.notify_users)
    union select distinct m.user_id from public.workspace_group_members m
      where exists (select 1 from unnest(rule.notify_groups) gid where public.unit_reaches(gid, m.user_id))
    union select task.assignee_id where 'assignee' = any (rule.notify_roles)
    union select task.reporter_id where 'reporter' = any (rule.notify_roles)
    union select a.user_id from public.task_project_access a where a.project_id = task.project_id and a.role = 'owner' and 'owner' = any (rule.notify_roles)
    union select p.created_by from public.task_projects p where p.id = task.project_id and 'owner' = any (rule.notify_roles)
  loop
    perform public.notify_person(task.workspace_id, person, what, actor, task.id, null, task.status_id);
  end loop;
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
    insert into public.workspace_group_members (group_id, workspace_id, user_id, is_lead)
    select (x ->> 'group_id')::uuid, ws_id, (x ->> 'user_id')::uuid, coalesce((x ->> 'is_lead')::boolean, false)
    from jsonb_array_elements(coalesce(payload -> 'group_members', '[]')) x
    on conflict (group_id, user_id) do update set is_lead = excluded.is_lead;
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
