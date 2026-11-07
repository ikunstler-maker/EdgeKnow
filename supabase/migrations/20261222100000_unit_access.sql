-- The same in supabase/team/migrations/0037_unit_access.sql.
-- Rollback: supabase/rollbacks/20261222100000_unit_access.down.sql

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

-- Who may change a unit: the role right, or a lead of it or of a unit above it.
create function public.can_manage_unit(ws uuid, target_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.role_allows(ws, 'manage_structure') or (
    public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid()) and exists (
      with recursive up as (
        select g.id, g.parent_id, 0 as level from public.workspace_groups g where g.id = target_group and g.workspace_id = ws
        union all
        select g.id, g.parent_id, u.level + 1 from public.workspace_groups g join up u on g.id = u.parent_id where u.level < 10
      )
      select 1 from public.workspace_group_members gm join up on gm.group_id = up.id where gm.user_id = auth.uid() and gm.is_lead
    )
  );
$$;
revoke execute on function public.can_manage_unit(uuid, uuid) from public, anon;
grant execute on function public.can_manage_unit(uuid, uuid) to authenticated;

-- A unit under another: whoever may change the parent (a lead of that branch too).
create or replace function public.create_workspace_group(ws uuid, new_name text, parent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(new_name, ''));
  new_id uuid;
begin
  if parent is null then
    return public.create_workspace_group(ws, new_name);
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = parent and g.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not public.can_manage_unit(ws, parent) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'create_group'));
    return public.ws_error('forbidden');
  end if;
  if char_length(clean) not between 1 and 60 then
    return public.ws_error('invalid_name');
  end if;
  if exists (select 1 from public.workspace_groups g where g.workspace_id = ws and lower(g.name) = lower(clean)) then
    return public.ws_error('group_exists');
  end if;
  begin
    insert into public.workspace_groups (workspace_id, name, created_by, parent_id) values (ws, clean, auth.uid(), parent) returning id into new_id;
  exception when raise_exception then
    return public.ws_error('group_too_deep');
  end;
  perform public.log_workspace_action(ws, 'group_created', jsonb_build_object('group', clean));
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- Mark (or unmark) a person in a unit as its lead.
create function public.set_group_lead(ws uuid, target_group uuid, member uuid, lead boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_unit(ws, target_group) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'set_group_lead'));
    return public.ws_error('forbidden');
  end if;
  if lead and public.is_guest(ws, member) then
    return public.ws_error('not_a_member');
  end if;
  update public.workspace_group_members gm set is_lead = coalesce(lead, false)
  where gm.group_id = target_group and gm.workspace_id = ws and gm.user_id = member;
  if not found then
    return public.ws_error('not_found');
  end if;
  perform public.log_workspace_action(ws, 'group_lead_set', jsonb_build_object('group', target_group, 'member', member, 'lead', lead));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_group_lead(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_group_lead(uuid, uuid, uuid, boolean) to authenticated;

create or replace function public.rename_workspace_group(ws uuid, target_group uuid, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(new_name, ''));
begin
  if not public.can_manage_unit(ws, target_group) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'rename_group'));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = target_group and g.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if char_length(clean) not between 1 and 60 then
    return public.ws_error('invalid_name');
  end if;
  if exists (select 1 from public.workspace_groups g where g.workspace_id = ws and lower(g.name) = lower(clean) and g.id <> target_group) then
    return public.ws_error('group_exists');
  end if;
  update public.workspace_groups set name = clean where id = target_group;
  perform public.log_workspace_action(ws, 'group_renamed', jsonb_build_object('group', clean));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_workspace_group(ws uuid, target_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_name text;
begin
  if not public.can_manage_unit(ws, target_group) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'delete_group'));
    return public.ws_error('forbidden');
  end if;
  delete from public.workspace_groups where id = target_group and workspace_id = ws returning name into old_name;
  if old_name is null then
    return public.ws_error('not_found');
  end if;
  perform public.log_workspace_action(ws, 'group_deleted', jsonb_build_object('group', old_name));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_workspace_group_member(ws uuid, target_group uuid, member uuid, included boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_name text;
begin
  if not public.can_manage_unit(ws, target_group) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'set_group_member'));
    return public.ws_error('forbidden');
  end if;
  select g.name into group_name from public.workspace_groups g where g.id = target_group and g.workspace_id = ws;
  if group_name is null then
    return public.ws_error('not_found');
  end if;
  if not included then
    delete from public.workspace_group_members where group_id = target_group and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if not public.is_active_member(ws, member) then
    return public.ws_error('not_a_member');
  end if;
  if public.is_guest(ws, member) then
    return public.ws_error('guest_role');
  end if;
  insert into public.workspace_group_members (group_id, workspace_id, user_id, added_by)
  values (target_group, ws, member, auth.uid())
  on conflict (group_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.move_workspace_group(ws uuid, target_group uuid, new_parent uuid, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A lead moves units inside their branch; the top level needs the role right.
  if not public.can_manage_unit(ws, target_group)
     or (new_parent is null and not public.role_allows(ws, 'manage_structure'))
     or (new_parent is not null and not public.can_manage_unit(ws, new_parent)) then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'move_group'));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = target_group and g.workspace_id = ws)
     or (new_parent is not null and not exists (select 1 from public.workspace_groups g where g.id = new_parent and g.workspace_id = ws)) then
    return public.ws_error('not_found');
  end if;
  begin
    update public.workspace_groups set parent_id = new_parent, position = coalesce(new_position, position) where id = target_group;
  exception when raise_exception then
    return public.ws_error(case when sqlerrm = 'group tree too deep' then 'group_too_deep' else 'group_cycle' end);
  end;
  perform public.log_workspace_action(ws, 'group_moved', jsonb_build_object('group', target_group));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.team_sync_payload(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility, m.access_until, m.custom_role_id
    from public.workspace_members m
    where m.workspace_id = ws and m.status = 'active'
      and (m.joined_via <> 'domain' or exists (
        select 1 from public.workspace_domains d join public.profiles p on p.id = m.user_id
        where d.workspace_id = ws and d.is_active and d.domain = public.email_domain(p.email)
      ))
  )
  select jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'short_id', w.short_id, 'name', w.name, 'owner_id', w.owner_id,
                                            'storage_limit_mb', w.storage_limit_mb, 'created_at', w.created_at)
                  from public.workspaces w where w.id = ws),
    'settings', jsonb_build_object('files_on_drive', exists (
      select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok')),
      'private_tasks_admin', (select w.private_tasks_admin from public.workspaces w where w.id = ws),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url) order by p.id)
                          from public.profiles p where p.id in (select user_id from members)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_via', m.joined_via,
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility,
                                                             'access_until', m.access_until, 'custom_role_id', m.custom_role_id) order by m.user_id)
                         from members m), '[]'),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'builtin', r.builtin, 'name', r.name, 'permissions', r.permissions,
                                                       'content_level', r.content_level, 'position', r.position) order by r.id)
                       from public.workspace_roles r where r.workspace_id = ws), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'parent_id', g.parent_id, 'position', g.position, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id, 'is_lead', gm.is_lead) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;
