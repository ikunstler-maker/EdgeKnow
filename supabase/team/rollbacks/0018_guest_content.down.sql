-- Back to before step Г4: guests make nothing again; pages already handed to
-- the workspace owner stay with the owner.

CREATE OR REPLACE FUNCTION public.create_page(ws uuid, parent uuid, new_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
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
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
    return public.page_error('forbidden');
  end if;

  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind = 'board')) then
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

CREATE OR REPLACE FUNCTION public.trash_service_object(target_object uuid, restore boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.service_objects
  set deleted_at = case when restore then null else now() end,
      deleted_by = case when restore then null else auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
  where id = target_object;
  return jsonb_build_object('ok', true);
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
    insert into public.workspace_members (workspace_id, user_id, role, joined_via, status, joined_at, profile_visibility, access_until)
    select ws_id, (m ->> 'user_id')::uuid, m ->> 'role', coalesce(m ->> 'joined_via', 'invite'), 'active',
           coalesce((m ->> 'joined_at')::timestamptz, now()), coalesce(m ->> 'profile_visibility', 'private'),
           (m ->> 'access_until')::timestamptz
    from jsonb_array_elements(payload -> 'members') m
    on conflict (workspace_id, user_id) do update set role = excluded.role, joined_via = excluded.joined_via,
      status = 'active', profile_visibility = excluded.profile_visibility, access_until = excluded.access_until;
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

drop function public.hand_guest_content_to_owner(uuid, uuid);
drop function public.workspace_owner_of(uuid);
