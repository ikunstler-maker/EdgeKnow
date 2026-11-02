-- Guests, step Г4: a guest makes pages, maps and boards (and tasks, as an editor
-- of a project), but the workspace owner owns what they make; the guest keeps
-- editing it. Someone who becomes a guest hands what they own to the owner too.
-- The same in supabase/team/migrations/0018_guest_content.sql.
-- Rollback: supabase/rollbacks/20261201100000_guest_content.down.sql

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
  -- "Own database first": this workspace connects its team's Supabase before it has pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
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
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
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

create or replace function public.join_workspaces()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_email text := public.current_email();
  invite record;
begin
  if my_email is null then
    return public.ws_error('forbidden');
  end if;

  -- Automatic joining by domain; people removed by an admin are not re-added.
  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  select d.workspace_id, auth.uid(), 'member', 'domain'
  from public.workspace_domains d
  where d.domain = public.email_domain(my_email) and d.is_active
  on conflict (workspace_id, user_id) do nothing;

  -- Invitations (also bring back a removed member, and outrank a domain join).
  for invite in
    select * from public.invitations i
    where i.email = my_email
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  loop
    insert into public.workspace_members as m (workspace_id, user_id, role, joined_via, access_until)
    values (invite.workspace_id, auth.uid(), invite.role, 'invite', case when invite.role = 'guest' then invite.access_until end)
    on conflict (workspace_id, user_id) do update
      set status = 'active',
          joined_via = case when m.joined_via = 'creator' then 'creator' else 'invite' end,
          role = case
            when m.role = 'owner' then 'owner'
            when m.status = 'removed' or m.role = 'guest' then excluded.role
            when excluded.role = 'admin' then 'admin'
            else m.role
          end,
          access_until = case
            when m.role <> 'owner' and (m.status = 'removed' or m.role = 'guest') then excluded.access_until
            else m.access_until
          end;

    -- Someone who comes back as a guest hands what they own to the workspace owner.
    if exists (select 1 from public.workspace_members m where m.workspace_id = invite.workspace_id and m.user_id = auth.uid() and m.role = 'guest') then
      perform public.hand_guest_content_to_owner(invite.workspace_id, auth.uid());
    end if;

    update public.invitations
    set accepted_at = now(), accepted_by = auth.uid()
    where id = invite.id;

    perform public.log_workspace_action(invite.workspace_id, 'invitation_accepted',
      jsonb_build_object('email', my_email));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'workspaces', coalesce((
      select jsonb_agg(w.short_id order by w.created_at)
      from public.workspaces w
      where public.is_workspace_member(w.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_member_role(ws uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'set_member_role'));
    return public.ws_error('forbidden');
  end if;
  if coalesce(new_role, '') not in ('admin', 'member', 'guest') then
    return public.ws_error('invalid_role');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = member and status = 'active'
  ) then
    return public.ws_error('not_a_member');
  end if;
  if (select role from public.workspace_members where workspace_id = ws and user_id = member) = 'owner' then
    return public.ws_error('owner_role');
  end if;

  update public.workspace_members
  set role = new_role, access_until = case when new_role = 'guest' then access_until end
  where workspace_id = ws and user_id = member;
  if new_role = 'guest' then
    -- What they own passes to the workspace owner; they keep editing it.
    perform public.hand_guest_content_to_owner(ws, member);
    delete from public.workspace_group_members where workspace_id = ws and user_id = member;
    -- A grant above editor becomes editor.
    update public.task_project_access set role = 'editor' where workspace_id = ws and user_id = member and role = 'owner';
    update public.service_object_access set role = 'editor' where workspace_id = ws and user_id = member and role = 'owner';
  end if;
  perform public.log_workspace_action(ws, 'member_role_changed', jsonb_build_object(
    'email', (select email from public.profiles where id = member), 'role', new_role));
  return jsonb_build_object('ok', true);
end;
$$;

-- Guests who already own something hand it over now.
select public.hand_guest_content_to_owner(m.workspace_id, m.user_id) from public.workspace_members m where m.role = 'guest' and m.status = 'active';
