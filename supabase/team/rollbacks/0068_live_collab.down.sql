-- Undo 0068_live_collab.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists edgeknow_live_read on realtime.messages;
    drop policy if exists edgeknow_live_write on realtime.messages;
  end if;
end $$;
drop function public.live_channel_allowed(text, text, boolean);
drop function public.set_live_viewer_cursors(uuid, boolean);
alter table public.service_objects drop column live_viewer_cursors;
alter table public.team_settings drop column live_collab;

-- team_sync as in 0037_unit_access.sql.
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
