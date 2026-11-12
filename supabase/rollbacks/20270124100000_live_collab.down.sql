-- Rollback of 20270124100000_live_collab.sql.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists edgeknow_live_read on realtime.messages;
    drop policy if exists edgeknow_live_write on realtime.messages;
  end if;
end $$;
drop function public.live_channel_allowed(text, text, boolean);
drop function public.set_live_viewer_cursors(uuid, boolean);
drop function public.set_live_collab(uuid, boolean);
alter table public.service_objects drop column live_viewer_cursors;
alter table public.workspaces drop column live_collab;

-- team_sync_payload as in 20261222100000_unit_access.sql.
create or replace function public.team_sync_payload(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility, m.access_until, m.custom_role_id
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
                                                             'access_until', m.access_until, 'custom_role_id', m.custom_role_id) order by m.user_id)
                         from members m), '[]'),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'builtin', r.builtin, 'name', r.name, 'permissions', r.permissions,
                                                       'content_level', r.content_level, 'position', r.position) order by r.id)
                       from public.workspace_roles r where r.workspace_id = ws), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'parent_id', g.parent_id, 'position', g.position, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id, 'is_lead', gm.is_lead) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;
