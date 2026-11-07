-- The same tree in supabase/team/migrations/0035_group_tree.sql.
-- Rollback: supabase/rollbacks/20261220100000_group_tree.down.sql

-- Company structure, stage 1: groups become a tree of units (company → department →
-- team), up to 8 levels. Access does not change yet (stage 3 lets it follow the tree).

alter table public.workspace_groups
  add column parent_id uuid references public.workspace_groups (id) on delete set null,
  add column position double precision not null default 0;
create index workspace_groups_parent_idx on public.workspace_groups (parent_id);

-- A parent of the same workspace, never the unit itself or one under it, at most 8 levels.
create function public.check_group_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  depth integer;
begin
  if new.parent_id is null then
    return new;
  end if;
  if (select g.workspace_id from public.workspace_groups g where g.id = new.parent_id) is distinct from new.workspace_id then
    raise exception 'group parent in another workspace';
  end if;
  if exists (
    with recursive up as (
      select g.id, g.parent_id, 1 as level from public.workspace_groups g where g.id = new.parent_id
      union all
      select g.id, g.parent_id, up.level + 1 from public.workspace_groups g join up on g.id = up.parent_id where up.level < 20
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'group cycle';
  end if;
  -- Levels above it plus its own subtree's height.
  depth := (
    with recursive up as (
      select g.id, g.parent_id from public.workspace_groups g where g.id = new.parent_id
      union all
      select g.id, g.parent_id from public.workspace_groups g join up on g.id = up.parent_id
    ) select count(*) from up
  ) + (
    with recursive down as (
      select g.id, 1 as level from public.workspace_groups g where g.parent_id = new.id
      union all
      select g.id, down.level + 1 from public.workspace_groups g join down on g.parent_id = down.id where down.level < 20
    ) select coalesce(max(level), 0) from down
  ) + 1;
  if depth > 8 then
    raise exception 'group tree too deep';
  end if;
  return new;
end;
$$;
create trigger workspace_groups_parent before insert or update of parent_id on public.workspace_groups
  for each row execute function public.check_group_parent();

-- Deleting a unit lifts its sub-units one level up (they are not lost).
create function public.lift_group_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Not while the whole workspace goes (its units all go with it).
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  update public.workspace_groups g set parent_id = old.parent_id where g.parent_id = old.id;
  return old;
end;
$$;
create trigger workspace_groups_lift before delete on public.workspace_groups
  for each row execute function public.lift_group_children();

-- Make a unit under another (or at the top); move one (workspace owner and admins).
create function public.create_workspace_group(ws uuid, new_name text, parent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  made jsonb;
begin
  if parent is not null and not exists (select 1 from public.workspace_groups g where g.id = parent and g.workspace_id = ws) then
    return public.ws_error('not_found');
  end if;
  made := public.create_workspace_group(ws, new_name);
  if coalesce((made ->> 'ok')::boolean, false) and parent is not null then
    begin
      update public.workspace_groups set parent_id = parent where id = (made ->> 'id')::uuid;
    exception when raise_exception then
      delete from public.workspace_groups where id = (made ->> 'id')::uuid;
      return public.ws_error('group_too_deep');
    end;
  end if;
  return made;
end;
$$;

create function public.move_workspace_group(ws uuid, target_group uuid, new_parent uuid, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
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

revoke execute on function public.create_workspace_group(uuid, text, uuid), public.move_workspace_group(uuid, uuid, uuid, double precision) from public, anon;
grant execute on function public.create_workspace_group(uuid, text, uuid), public.move_workspace_group(uuid, uuid, uuid, double precision) to authenticated;
revoke execute on function public.check_group_parent(), public.lift_group_children() from public, anon, authenticated;

-- The copy for a team's own database now carries the tree.
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
      'private_tasks_admin', (select w.private_tasks_admin from public.workspaces w where w.id = ws),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url) order by p.id)
                          from public.profiles p where p.id in (select user_id from members)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_via', m.joined_via,
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility,
                                                             'access_until', m.access_until) order by m.user_id)
                         from members m), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'parent_id', g.parent_id, 'position', g.position, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;
