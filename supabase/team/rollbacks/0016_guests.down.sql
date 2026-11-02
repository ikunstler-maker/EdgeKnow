-- Back to before guests in a team database.
update public.workspace_members set status = 'removed', role = 'member' where role = 'guest';

drop policy "Members can read the member list" on public.workspace_members;
create policy "Members can read the member list" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy "Members read their workspace's groups" on public.workspace_groups;
create policy "Members read their workspace's groups" on public.workspace_groups
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy "Members read who is in their workspace's groups" on public.workspace_group_members;
create policy "Members read who is in their workspace's groups" on public.workspace_group_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_active_member(ws uuid, member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = member and m.status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.shares_workspace_with(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (other = auth.uid() and public.current_email() is not null)
      or exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs
          on theirs.workspace_id = mine.workspace_id
         and theirs.user_id = other
         and theirs.status = 'active'
        where mine.user_id = auth.uid() and public.is_workspace_member(mine.workspace_id)
      );
$function$;

CREATE OR REPLACE FUNCTION public.page_role_of(target_page uuid, member uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.task_project_role_of(target_project uuid, member uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with project as (select * from public.task_projects p where p.id = target_project),
  candidates as (
    select 'owner' as role from project p
    join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select p.workspace_role from project p where p.workspace_role is not null and public.is_active_member(p.workspace_id, member)
    union all
    select a.role from public.task_project_access a where a.project_id = target_project and a.user_id = member
    union all
    select ga.role from public.task_project_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    where ga.project_id = target_project
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.service_object_role_of(target_object uuid, member uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with object as (select * from public.service_objects o where o.id = target_object),
  candidates as (
    select 'owner' as role from object o where o.owner_id = member and public.is_active_member(o.workspace_id, member)
    union all
    select 'owner' from object o
    join public.workspace_members m on m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select o.workspace_role from object o where o.workspace_role is not null and public.is_active_member(o.workspace_id, member)
    union all
    select a.role from public.service_object_access a where a.object_id = target_object and a.user_id = member
    union all
    select ga.role from public.service_object_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    where ga.object_id = target_object
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.set_task_project_member_role(target_project uuid, member uuid, new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  project public.task_projects;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into project from public.task_projects where id = target_project;
  if new_role is null then
    delete from public.task_project_access where project_id = target_project and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not public.is_active_member(project.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;
  insert into public.task_project_access (project_id, workspace_id, user_id, role, granted_by)
  values (target_project, project.workspace_id, member, new_role, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_service_object_member_role(target_object uuid, member uuid, new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object);
begin
  if coalesce(public.service_object_role(target_object), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if new_role is null then
    delete from public.service_object_access where object_id = target_object and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not public.is_active_member(ws, member) then
    return public.page_error('not_a_member');
  end if;
  insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
  values (target_object, ws, member, new_role, auth.uid())
  on conflict (object_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_page_ownership(target_page uuid, new_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.mention_candidates(target_page uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ws uuid;
begin
  if public.effective_role(target_page) is null then
    return public.page_error('forbidden');
  end if;
  select workspace_id into ws from public.pages where id = target_page;
  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email)
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = ws and m.status = 'active' and m.user_id <> auth.uid()
      and public.page_role_of(target_page, m.user_id) is not null
  ), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_page(ws uuid, parent uuid, new_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if target_service not in ('nodes') or (target_service = 'nodes' and new_kind not in ('mindmap', 'flow')) then
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
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), auth.uid(), auth.uid(), auth.uid())
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$function$;

CREATE OR REPLACE FUNCTION public.team_sync(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke execute on function public.team_sync(jsonb) from public, anon, authenticated;
drop function public.can_see_member(uuid, uuid);
drop function public.is_workspace_insider(uuid);
drop function public.guest_sees(uuid, uuid);
drop function public.is_guest(uuid, uuid);
alter table public.workspace_members drop column access_until;
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));
