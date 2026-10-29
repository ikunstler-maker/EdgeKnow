-- Undo 0005_groups.sql: groups and what they were given go; people's own
-- grants are untouched.
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
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$function$

;

CREATE OR REPLACE FUNCTION public.page_sharing(target_page uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  my text := public.effective_role(target_page);
  page public.pages;
  inherited_ws text;
  entries jsonb;
  members jsonb := '[]'::jsonb;
begin
  if my is null then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;

  select c.workspace_role into inherited_ws
  from public.access_chain(target_page) c
  where c.depth > 0 and c.workspace_role is not null
  order by public.role_rank(c.workspace_role) desc
  limit 1;

  with sources as (
    select a.user_id, a.role, c.depth, c.id as from_page
    from public.access_chain(target_page) c
    join public.page_access a on a.page_id = c.id
    union all
    select c.owner_id, 'editor', c.depth, c.id
    from public.access_chain(target_page) c
    where c.depth > 0
  ),
  best as (
    -- One line per person: their highest role; their own grant wins a tie.
    select distinct on (s.user_id) s.user_id, s.role, s.depth, s.from_page
    from sources s
    where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
    order by s.user_id, public.role_rank(s.role) desc, s.depth
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', b.user_id,
      'name', pr.name,
      'email', pr.email,
      'role', b.role,
      'own', exists (select 1 from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'own_role', (select a.role from public.page_access a where a.page_id = target_page and a.user_id = b.user_id),
      'inherited_from', case when b.depth > 0 then b.from_page end,
      'inherited_title', case
        when b.depth > 0 and public.effective_role(b.from_page) is not null
        then (select f.title from public.pages f where f.id = b.from_page)
      end
    ) order by pr.name nulls last, pr.email), '[]'::jsonb)
    into entries
  from best b
  join public.profiles pr on pr.id = b.user_id;

  if my = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email), '[]'::jsonb)
      into members
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = page.workspace_id and m.status = 'active' and m.user_id <> page.owner_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'my_role', my,
    'owner', (select jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
              from public.profiles pr where pr.id = page.owner_id),
    'has_parent', page.parent_id is not null,
    'inherit', page.inherit,
    'workspace_role', page.workspace_role,
    'inherited_workspace_role', case when page.parent_id is not null and page.inherit then inherited_ws end,
    'entries', entries,
    'members', members
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_page_inherit(target_page uuid, new_inherit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  page public.pages;
  inherited_ws text;
begin
  if coalesce(public.effective_role(target_page), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into page from public.pages where id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if page.parent_id is null then
    return public.page_error('no_parent');
  end if;
  if page.inherit = new_inherit then
    return jsonb_build_object('ok', true);
  end if;

  if not new_inherit then
    with sources as (
      select a.user_id, a.role from public.access_chain(target_page) c
      join public.page_access a on a.page_id = c.id
      where c.depth > 0
      union all
      select c.owner_id, 'editor' from public.access_chain(target_page) c where c.depth > 0
    ),
    best as (
      select distinct on (s.user_id) s.user_id, s.role
      from sources s
      where s.user_id <> page.owner_id and public.is_active_member(page.workspace_id, s.user_id)
      order by s.user_id, public.role_rank(s.role) desc
    )
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    select page.workspace_id, target_page, b.user_id, b.role, auth.uid() from best b
    on conflict (page_id, user_id) do update
      set role = case when public.role_rank(excluded.role) > public.role_rank(public.page_access.role)
                      then excluded.role else public.page_access.role end;

    select c.workspace_role into inherited_ws
    from public.access_chain(target_page) c
    where c.workspace_role is not null
    order by public.role_rank(c.workspace_role) desc
    limit 1;
    update public.pages set inherit = false, workspace_role = inherited_ws where id = target_page;
  else
    update public.pages set inherit = true where id = target_page;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.drop_grants_of_removed_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'active' then
    delete from public.page_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$function$

;

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

drop function if exists public.set_page_group_role(uuid, uuid, text);
drop table if exists public.page_group_access;
drop table if exists public.workspace_group_members;
drop table if exists public.workspace_groups;
drop function if exists public.check_group_workspace();
