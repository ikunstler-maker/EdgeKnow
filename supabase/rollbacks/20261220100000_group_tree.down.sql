-- Undo 20261220100000_group_tree.
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
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;

drop function if exists public.move_workspace_group(uuid, uuid, uuid, double precision);
drop function if exists public.create_workspace_group(uuid, text, uuid);
drop trigger if exists workspace_groups_lift on public.workspace_groups;
drop trigger if exists workspace_groups_parent on public.workspace_groups;
drop function if exists public.lift_group_children();
drop function if exists public.check_group_parent();
alter table public.workspace_groups drop column if exists position, drop column if exists parent_id;
