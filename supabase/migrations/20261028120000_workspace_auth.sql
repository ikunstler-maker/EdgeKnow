-- Workspaces (M3): sign-in by domain or invitation, automatic joining, and the
-- actions of workspace owners/admins and the platform admin.
--
-- Every action returns {"ok": true, ...} or {"ok": false, "error": "<code>"}.
-- Denied attempts are written to the audit log (returning instead of raising
-- keeps that log entry).
-- Rollback: supabase/rollbacks/20261028120000_workspace_auth.down.sql

create function public.ws_error(code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'error', code);
$$;

create function public.is_valid_domain(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
$$;

create function public.hash_token(token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex');
$$;

-------------------------------------------------------------------------------
-- Sign-in
-------------------------------------------------------------------------------

-- Before User Created hook: an account is created only for an active workspace
-- domain, a pending invitation for that email, or while registration is open.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  user_domain text := public.email_domain(user_email);
begin
  if user_email <> '' and (
    exists (
      select 1 from public.workspace_domains d where d.domain = user_domain and d.is_active
    )
    or exists (
      select 1 from public.invitations i
      where i.email = user_email
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    )
    or (select open_registration from public.platform_settings)
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'domain_not_allowed')
  );
end;
$$;

-- Called after every sign-in: joins workspaces whose active domain matches the
-- email and accepts pending invitations for it. Returns the workspaces the user
-- can open now.
create function public.join_workspaces()
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
    insert into public.workspace_members as m (workspace_id, user_id, role, joined_via)
    values (invite.workspace_id, auth.uid(), invite.role, 'invite')
    on conflict (workspace_id, user_id) do update
      set status = 'active',
          joined_via = case when m.joined_via = 'creator' then 'creator' else 'invite' end,
          role = case
            when m.role = 'owner' then 'owner'
            when m.status = 'removed' then excluded.role
            when excluded.role = 'admin' then 'admin'
            else m.role
          end;

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

-- Google `hd` hint for "sign in to <workspace>" links: its domain, if it has exactly one.
create function public.workspace_login_hint(ws_short_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then min(d.domain) end
  from public.workspace_domains d
  join public.workspaces w on w.id = d.workspace_id
  where w.short_id = ws_short_id and d.is_active;
$$;

-- What an invitation link shows before signing in. Knowing the token is the proof.
create function public.invitation_preview(token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace', w.name,
    'workspace_short_id', w.short_id,
    'email', i.email,
    'valid', i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  )
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = public.hash_token(token);
$$;

-------------------------------------------------------------------------------
-- Workspaces
-------------------------------------------------------------------------------

create function public.create_workspace(new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := trim(coalesce(new_name, ''));
  ws public.workspaces;
begin
  if not public.has_platform_access() then
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;

  insert into public.workspaces (name, owner_id, created_by)
  values (cleaned, auth.uid(), auth.uid())
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  values (ws.id, auth.uid(), 'owner', 'creator');

  perform public.log_workspace_action(ws.id, 'workspace_created', jsonb_build_object('name', cleaned));
  perform public.log_workspace_action(null, 'workspace_created',
    jsonb_build_object('workspace_id', ws.id, 'name', cleaned));
  return jsonb_build_object('ok', true, 'id', ws.id, 'short_id', ws.short_id);
end;
$$;

create function public.rename_workspace(ws uuid, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := trim(coalesce(new_name, ''));
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'rename_workspace'));
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;

  update public.workspaces set name = cleaned where id = ws;
  perform public.log_workspace_action(ws, 'workspace_renamed', jsonb_build_object('name', cleaned));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.transfer_workspace_ownership(ws uuid, new_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.workspace_role(ws), '') <> 'owner' then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'transfer_ownership'));
    return public.ws_error('forbidden');
  end if;
  if new_owner = auth.uid() then
    return public.ws_error('already_owner');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = new_owner and status = 'active'
  ) then
    return public.ws_error('not_a_member');
  end if;

  -- The former owner stays as an admin.
  update public.workspace_members set role = 'admin' where workspace_id = ws and user_id = auth.uid();
  update public.workspace_members
  set role = 'owner', joined_via = 'creator'
  where workspace_id = ws and user_id = new_owner;
  update public.workspaces set owner_id = new_owner where id = ws;

  perform public.log_workspace_action(ws, 'ownership_transferred',
    jsonb_build_object('to', (select email from public.profiles where id = new_owner)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Permanent; the owner confirms by typing the workspace name.
create function public.delete_workspace(ws uuid, confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_name text;
begin
  if coalesce(public.workspace_role(ws), '') <> 'owner' then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'delete_workspace'));
    return public.ws_error('forbidden');
  end if;

  select name into ws_name from public.workspaces where id = ws;
  if trim(coalesce(confirm_name, '')) <> ws_name then
    return public.ws_error('name_mismatch');
  end if;

  perform public.log_workspace_action(null, 'workspace_deleted',
    jsonb_build_object('workspace_id', ws, 'name', ws_name));
  -- Pages, members, domains, invitations and the workspace log go with it (ON DELETE CASCADE).
  delete from public.workspaces where id = ws;
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Domains (Notion's rule: you can add only the domain of your own email)
-------------------------------------------------------------------------------

-- After `changed_domain` stops granting access, does an owner or admin keep access?
create function public.admin_keeps_access_without(ws uuid, changed_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = ws
      and m.status = 'active'
      and m.role in ('owner', 'admin')
      and (
        m.joined_via <> 'domain'
        or exists (
          select 1 from public.workspace_domains d
          where d.workspace_id = ws and d.is_active
            and d.domain = public.email_domain(p.email)
            and d.domain <> changed_domain
        )
      )
  );
$$;

create function public.add_workspace_domain(ws uuid, new_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(new_domain, '')));
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'add_domain', 'domain', normalized));
    return public.ws_error('forbidden');
  end if;
  if not public.is_valid_domain(normalized) then
    return public.ws_error('invalid_domain');
  end if;
  if exists (select 1 from public.public_email_domains where domain = normalized) then
    return public.ws_error('public_domain');
  end if;
  if normalized <> public.email_domain(public.current_email()) then
    return public.ws_error('domain_mismatch');
  end if;
  if exists (select 1 from public.workspace_domains where domain = normalized) then
    return public.ws_error('domain_taken');
  end if;

  insert into public.workspace_domains (domain, workspace_id, verified, added_by)
  values (normalized, ws, true, auth.uid());
  perform public.log_workspace_action(ws, 'domain_added', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_workspace_domain_active(ws uuid, target_domain text, active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'set_domain_active', 'domain', target_domain));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_domains where domain = target_domain and workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not active and not public.admin_keeps_access_without(ws, target_domain) then
    return public.ws_error('last_admin_domain');
  end if;

  update public.workspace_domains set is_active = active where domain = target_domain;
  perform public.log_workspace_action(ws,
    case when active then 'domain_enabled' else 'domain_disabled' end,
    jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.remove_workspace_domain(ws uuid, target_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'remove_domain', 'domain', target_domain));
    return public.ws_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_domains where domain = target_domain and workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  if not public.admin_keeps_access_without(ws, target_domain) then
    return public.ws_error('last_admin_domain');
  end if;

  delete from public.workspace_domains where domain = target_domain;
  perform public.log_workspace_action(ws, 'domain_removed', jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Members and invitations
-------------------------------------------------------------------------------

-- Creates (or renews) an invitation; returns the one-time link token.
create function public.invite_member(ws uuid, invitee_email text, invitee_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(invitee_email, '')));
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  invitation_id uuid;
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'invite_member', 'email', normalized));
    return public.ws_error('forbidden');
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return public.ws_error('invalid_email');
  end if;
  if coalesce(invitee_role, '') not in ('admin', 'member') then
    return public.ws_error('invalid_role');
  end if;
  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = ws and p.email = normalized and m.status = 'active'
      and m.joined_via <> 'domain'
  ) then
    return public.ws_error('already_member');
  end if;

  -- A new link replaces any earlier pending one for the same person.
  update public.invitations
  set revoked_at = now()
  where workspace_id = ws and email = normalized and accepted_at is null and revoked_at is null;

  insert into public.invitations (workspace_id, email, role, token_hash, invited_by)
  values (ws, normalized, invitee_role, public.hash_token(token), auth.uid())
  returning id into invitation_id;

  perform public.log_workspace_action(ws, 'member_invited',
    jsonb_build_object('email', normalized, 'role', invitee_role));
  return jsonb_build_object('ok', true, 'id', invitation_id, 'token', token);
end;
$$;

create function public.revoke_invitation(ws uuid, target_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitee text;
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'revoke_invitation'));
    return public.ws_error('forbidden');
  end if;

  update public.invitations
  set revoked_at = now()
  where id = target_invitation and workspace_id = ws and accepted_at is null and revoked_at is null
  returning email into invitee;
  if invitee is null then
    return public.ws_error('not_found');
  end if;

  perform public.log_workspace_action(ws, 'invitation_revoked', jsonb_build_object('email', invitee));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_member_role(ws uuid, member uuid, new_role text)
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
  if coalesce(new_role, '') not in ('admin', 'member') then
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

  update public.workspace_members set role = new_role where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws, 'member_role_changed', jsonb_build_object(
    'email', (select email from public.profiles where id = member), 'role', new_role));
  return jsonb_build_object('ok', true);
end;
$$;

-- Admins remove others; anyone but the owner can leave on their own.
create function public.remove_member(ws uuid, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if member <> auth.uid() and not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'remove_member'));
    return public.ws_error('forbidden');
  end if;
  if member = auth.uid() and not public.is_workspace_member(ws) then
    return public.ws_error('forbidden');
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

  -- Kept as 'removed' so their domain doesn't bring them back; their pages stay.
  update public.workspace_members
  set status = 'removed', role = 'member'
  where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws,
    case when member = auth.uid() then 'member_left' else 'member_removed' end,
    jsonb_build_object('email', (select email from public.profiles where id = member)));
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Platform admin: statistics only, never page contents
-------------------------------------------------------------------------------

create function public.platform_workspaces()
returns table (
  id uuid,
  short_id text,
  name text,
  owner_email text,
  members bigint,
  pages bigint,
  storage_bytes bigint,
  storage_limit_mb integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    return;
  end if;
  return query
    select
      w.id, w.short_id, w.name, o.email,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
      (select count(*) from public.pages p where p.workspace_id = w.id),
      0::bigint, -- file usage arrives with attachments (stage 4)
      w.storage_limit_mb,
      w.created_at
    from public.workspaces w
    join public.profiles o on o.id = w.owner_id
    order by w.created_at;
end;
$$;

create function public.set_open_registration(open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied',
      jsonb_build_object('attempted', 'set_open_registration'));
    return public.ws_error('forbidden');
  end if;
  update public.platform_settings
  set open_registration = open, updated_at = now(), updated_by = auth.uid();
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.ws_error(text),
  public.is_valid_domain(text),
  public.hash_token(text),
  public.hook_before_user_created(jsonb),
  public.join_workspaces(),
  public.workspace_login_hint(text),
  public.invitation_preview(text),
  public.create_workspace(text),
  public.rename_workspace(uuid, text),
  public.transfer_workspace_ownership(uuid, uuid),
  public.delete_workspace(uuid, text),
  public.admin_keeps_access_without(uuid, text),
  public.add_workspace_domain(uuid, text),
  public.set_workspace_domain_active(uuid, text, boolean),
  public.remove_workspace_domain(uuid, text),
  public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid, uuid),
  public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid),
  public.platform_workspaces(),
  public.set_open_registration(boolean)
from public, anon, authenticated;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function
  public.workspace_login_hint(text),
  public.invitation_preview(text)
to anon, authenticated;
grant execute on function
  public.join_workspaces(),
  public.create_workspace(text),
  public.rename_workspace(uuid, text),
  public.transfer_workspace_ownership(uuid, uuid),
  public.delete_workspace(uuid, text),
  public.add_workspace_domain(uuid, text),
  public.set_workspace_domain_active(uuid, text, boolean),
  public.remove_workspace_domain(uuid, text),
  public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid, uuid),
  public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid),
  public.platform_workspaces(),
  public.set_open_registration(boolean)
to authenticated;
