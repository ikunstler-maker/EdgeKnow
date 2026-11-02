-- Guests (step Г1): customers and contractors who see only what was shared with them.
-- The same rules in supabase/team/migrations/0016_guests.sql.
-- Rollback: supabase/rollbacks/20261129100000_guests.down.sql

-- A guest is a workspace member with the role 'guest'; their access may end on a date.
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'member', 'guest'));
alter table public.workspace_members add column access_until timestamptz;

alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('admin', 'member', 'guest'));
alter table public.invitations add column access_until timestamptz;

-- A guest whose date has passed is no longer a member anywhere (their grants stay,
-- so a new date brings everything back).
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.role <> 'guest' or m.access_until is null or m.access_until > now())
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
$$;

create or replace function public.is_active_member(ws uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = member and m.status = 'active'
      and (m.role <> 'guest' or m.access_until is null or m.access_until > now())
  );
$$;

-- Is this person a guest of the workspace (whatever their status)?
create function public.is_guest(ws uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = member and m.role = 'guest'
  );
$$;
revoke execute on function public.is_guest(uuid, uuid) from public, anon, authenticated;

-- Whom a guest sees: the workspace's owner and admins, and the people on what was
-- shared with them directly (who else has access, who made it, who works on it,
-- who commented). Not the rest of the member list.
create function public.guest_sees(ws uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws and m.user_id = other and m.status = 'active' and m.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.page_access mine
      join public.page_access theirs on theirs.page_id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.page_access mine
      join public.pages p on p.id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (p.owner_id, p.updated_by)
    )
    or exists (
      select 1 from public.page_access mine
      join public.comment_threads t on t.page_id = mine.page_id
      join public.comments c on c.thread_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.task_project_access theirs on theirs.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (t.assignee_id, t.reporter_id, t.updated_by)
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_comments c on c.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_events e on e.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and e.actor_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_object_access theirs on theirs.object_id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_objects o on o.id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (o.owner_id, o.updated_by)
    );
$$;
revoke execute on function public.guest_sees(uuid, uuid) from public, anon, authenticated;

-- A member who is not a guest (groups, the member list, creating things).
create function public.is_workspace_insider(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid());
$$;
revoke execute on function public.is_workspace_insider(uuid) from public, anon;
grant execute on function public.is_workspace_insider(uuid) to authenticated;

-- May the signed-in person see this member's row?
create function public.can_see_member(ws uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws)
     and (not public.is_guest(ws, auth.uid()) or public.guest_sees(ws, member));
$$;
revoke execute on function public.can_see_member(uuid, uuid) from public, anon;
grant execute on function public.can_see_member(uuid, uuid) to authenticated;

drop policy "Members can read the member list" on public.workspace_members;
create policy "Members can read the member list" on public.workspace_members
  for select to authenticated
  using (public.can_see_member(workspace_id, user_id));

drop policy "Members read their workspace's groups" on public.workspace_groups;
create policy "Members read their workspace's groups" on public.workspace_groups
  for select to authenticated
  using (public.is_workspace_insider(workspace_id));

drop policy "Members read who is in their workspace's groups" on public.workspace_group_members;
create policy "Members read who is in their workspace's groups" on public.workspace_group_members
  for select to authenticated
  using (public.is_workspace_insider(workspace_id));

-- Profiles: a guest reads only the people they see.
create or replace function public.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (other = auth.uid() and public.current_email() is not null)
      or exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs
          on theirs.workspace_id = mine.workspace_id
         and theirs.user_id = other
         and theirs.status = 'active'
        where mine.user_id = auth.uid() and public.is_workspace_member(mine.workspace_id)
          and (mine.role <> 'guest' or public.guest_sees(mine.workspace_id, other))
      );
$$;

-- Roles: for a guest, "the whole workspace" and groups give nothing, and a grant
-- never makes them more than an editor (what they made themselves stays theirs).
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
    select c.workspace_role from chain c where c.workspace_role is not null and not (select g.yes from guest g)
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
    select p.workspace_role from project p, guest g
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
    select o.workspace_role from object o, guest g
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

-- Sharing with a guest: up to editor.
create or replace function public.set_task_project_member_role(target_project uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if new_role = 'owner' and public.is_guest(project.workspace_id, member) then
    return public.page_error('guest_role');
  end if;
  insert into public.task_project_access (project_id, workspace_id, user_id, role, granted_by)
  values (target_project, project.workspace_id, member, new_role, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_service_object_member_role(target_object uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if new_role = 'owner' and public.is_guest(ws, member) then
    return public.page_error('guest_role');
  end if;
  insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
  values (target_object, ws, member, new_role, auth.uid())
  on conflict (object_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

-- A page is never handed over to a guest.
create or replace function public.transfer_page_ownership(target_page uuid, new_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if public.is_guest(page.workspace_id, new_owner) then
    return public.page_error('guest_role');
  end if;

  delete from public.page_access where page_id = target_page and user_id = new_owner;
  insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
  values (page.workspace_id, target_page, page.owner_id, 'editor', auth.uid())
  on conflict (page_id, user_id) do update set role = 'editor';
  update public.pages set owner_id = new_owner where id = target_page;
  return jsonb_build_object('ok', true);
end;
$$;

-- People to mention on a page: for a guest, only the people they see.
create or replace function public.mention_candidates(target_page uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      and (not public.is_guest(ws, auth.uid()) or public.guest_sees(ws, m.user_id))
  ), '[]'::jsonb));
end;
$$;

-- Guests work in what was shared with them; they don't start new pages.
create or replace function public.create_page(ws uuid, parent uuid, new_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
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
$$;

create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
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
$$;

-- Inviting: owners and admins invite a guest, optionally until a date.
drop function public.invite_member(uuid, text, text);
create function public.invite_member(ws uuid, invitee_email text, invitee_role text, guest_until timestamptz default null)
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
  if coalesce(invitee_role, '') not in ('admin', 'member', 'guest') then
    return public.ws_error('invalid_role');
  end if;
  if invitee_role = 'guest' and guest_until is not null and guest_until <= now() then
    return public.ws_error('invalid_date');
  end if;
  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = ws and p.email = normalized and m.status = 'active'
      and m.joined_via <> 'domain' and m.role <> 'guest'
  ) then
    return public.ws_error('already_member');
  end if;

  -- A new link replaces any earlier pending one for the same person.
  update public.invitations
  set revoked_at = now()
  where workspace_id = ws and email = normalized and accepted_at is null and revoked_at is null;

  insert into public.invitations (workspace_id, email, role, token_hash, invited_by, access_until)
  values (ws, normalized, invitee_role, public.hash_token(token), auth.uid(),
          case when invitee_role = 'guest' then guest_until end)
  returning id into invitation_id;

  perform public.log_workspace_action(ws, 'member_invited',
    jsonb_build_object('email', normalized, 'role', invitee_role));
  return jsonb_build_object('ok', true, 'id', invitation_id, 'token', token);
end;
$$;
revoke execute on function public.invite_member(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.invite_member(uuid, text, text, timestamptz) to authenticated;

-- Accepting: a guest invitation makes a guest (never lowers a colleague); a member
-- invitation turns a guest into a member.
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

-- Changing someone's role: also to and from guest. A new guest leaves the groups;
-- a guest who becomes a member has no end date any more.
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

-- Until when a guest has access (null: no end date).
create function public.set_guest_access_until(ws uuid, member uuid, until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'set_guest_access_until'));
    return public.ws_error('forbidden');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = member and status = 'active' and role = 'guest'
  ) then
    return public.ws_error('not_a_guest');
  end if;
  if until is not null and until <= now() then
    return public.ws_error('invalid_date');
  end if;
  update public.workspace_members set access_until = until where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws, 'guest_access_until', jsonb_build_object(
    'email', (select email from public.profiles where id = member), 'until', until));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_guest_access_until(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.set_guest_access_until(uuid, uuid, timestamptz) to authenticated;

-- Removing keeps nothing of the guest's date.
create or replace function public.remove_member(ws uuid, member uuid)
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
  set status = 'removed', role = 'member', access_until = null
  where workspace_id = ws and user_id = member;
  perform public.log_workspace_action(ws,
    case when member = auth.uid() then 'member_left' else 'member_removed' end,
    jsonb_build_object('email', (select email from public.profiles where id = member)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Never a guest as owner of the workspace, nor in a group.
create or replace function public.transfer_workspace_ownership(ws uuid, new_owner uuid)
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
  if public.is_guest(ws, new_owner) then
    return public.ws_error('guest_role');
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

create or replace function public.set_workspace_group_member(ws uuid, target_group uuid, member uuid, included boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if public.is_guest(ws, member) then
    return public.ws_error('guest_role');
  end if;
  insert into public.workspace_group_members (group_id, workspace_id, user_id, added_by)
  values (target_group, ws, member, auth.uid())
  on conflict (group_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- The team database gets each guest's date too.
create or replace function public.team_sync_payload(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility, m.access_until
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
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility,
                                                             'access_until', m.access_until) order by m.user_id)
                         from members m), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;
