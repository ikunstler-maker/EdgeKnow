-- Back to before guests: guests become removed members (their grants go with
-- them), the dates are dropped and the functions are as they were.
update public.workspace_members set status = 'removed', role = 'member' where role = 'guest';
update public.invitations set revoked_at = now() where role = 'guest' and accepted_at is null and revoked_at is null;
delete from public.invitations where role = 'guest';

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
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.current_email() is not null
      and (
        m.joined_via <> 'domain'
        or exists (
          select 1 from public.workspace_domains d
          where d.workspace_id = ws
            and d.is_active
            and d.domain = public.email_domain(public.current_email())
        )
      )
  )
  and not exists (select 1 from public.workspaces w where w.id = ws and w.frozen_at is not null);
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
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
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

CREATE OR REPLACE FUNCTION public.join_workspaces()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_member_role(ws uuid, member uuid, new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.remove_member(ws uuid, member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(ws uuid, new_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_workspace_group_member(ws uuid, target_group uuid, member uuid, included boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_name text;
begin
  if not public.is_workspace_admin(ws) then
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
  insert into public.workspace_group_members (group_id, workspace_id, user_id, added_by)
  values (target_group, ws, member, auth.uid())
  on conflict (group_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.team_sync_payload(ws uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility
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
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url) order by p.id)
                          from public.profiles p where p.id in (select user_id from members)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_via', m.joined_via,
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility) order by m.user_id)
                         from members m), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$function$;

drop function public.invite_member(uuid, text, text, timestamptz);
CREATE OR REPLACE FUNCTION public.invite_member(ws uuid, invitee_email text, invitee_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke execute on function public.invite_member(uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
drop function public.set_guest_access_until(uuid, uuid, timestamptz);
drop function public.can_see_member(uuid, uuid);
drop function public.is_workspace_insider(uuid);
drop function public.guest_sees(uuid, uuid);
drop function public.is_guest(uuid, uuid);
alter table public.invitations drop column access_until;
alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check check (role in ('admin', 'member'));
alter table public.workspace_members drop column access_until;
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));
