-- Guests, step Г4, in a team's own database (as supabase/migrations/20261201100000_guest_content.sql).
-- Rollback: supabase/team/rollbacks/0018_guest_content.down.sql

-- The workspace's owner: whoever gets what a guest makes.
create function public.workspace_owner_of(ws uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.owner_id from public.workspaces w where w.id = ws;
$$;
revoke execute on function public.workspace_owner_of(uuid) from public, anon, authenticated;

-- A guest's pages, maps and boards pass to the workspace owner; the guest keeps
-- editing them. Used when someone becomes a guest.
create function public.hand_guest_content_to_owner(ws uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  boss uuid := public.workspace_owner_of(ws);
begin
  if boss is null or boss = member then
    return;
  end if;
  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  select p.workspace_id, p.id, member, 'editor', boss from public.pages p
  where p.workspace_id = ws and p.owner_id = member
  on conflict (page_id, user_id) do update set role = 'editor';
  update public.pages set owner_id = boss where workspace_id = ws and owner_id = member;
  insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
  select o.id, o.workspace_id, member, 'editor', boss from public.service_objects o
  where o.workspace_id = ws and o.owner_id = member
  on conflict (object_id, user_id) do update set role = 'editor';
  update public.service_objects set owner_id = boss where workspace_id = ws and owner_id = member;
end;
$$;
revoke execute on function public.hand_guest_content_to_owner(uuid, uuid) from public, anon, authenticated;

-- Guests make pages too; the workspace owner owns them.
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

-- Guests make maps and boards too; the workspace owner owns them.
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
          public.service_object_text(new_data), case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(), auth.uid())
  returning id into new_id;
  -- A guest's map or board belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
    values (new_id, ws, auth.uid(), 'editor', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

-- Guests don't throw maps and boards away (they own none).
create or replace function public.trash_service_object(target_object uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor')
     or public.is_guest((select o.workspace_id from public.service_objects o where o.id = target_object), auth.uid()) then
    return public.page_error('forbidden');
  end if;
  update public.service_objects
  set deleted_at = case when restore then null else now() end,
      deleted_by = case when restore then null else auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
  where id = target_object;
  return jsonb_build_object('ok', true);
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

  -- Guests own nothing here: what they made passes to the workspace owner.
  if payload ? 'members' then
    perform public.hand_guest_content_to_owner(ws_id, m.user_id)
    from public.workspace_members m
    where m.workspace_id = ws_id and m.status = 'active' and m.role = 'guest'
      and (exists (select 1 from public.pages p where p.workspace_id = ws_id and p.owner_id = m.user_id)
        or exists (select 1 from public.service_objects o where o.workspace_id = ws_id and o.owner_id = m.user_id));
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
revoke execute on function public.team_sync(jsonb) from public, anon, authenticated;

-- Guests who already own something hand it over now.
select public.hand_guest_content_to_owner(m.workspace_id, m.user_id) from public.workspace_members m where m.role = 'guest' and m.status = 'active';
