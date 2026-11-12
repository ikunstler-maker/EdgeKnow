-- Real-time co-editing, phase 1 (decision 2026-11-12): who may join a document's live
-- channels and send on them. The channels carry document changes ("doc") and cursors,
-- presence and "follow" ("room"); nothing of them is stored.
-- The same in supabase/team/migrations/0070_live_collab.sql.
-- Rollback: supabase/rollbacks/20270125100000_live_collab.down.sql

-- The workspace's owner turns co-editing on; off by default.
alter table public.workspaces
  add column live_collab boolean not null default false;

-- Per document: may people who only view or comment show their cursors? Off by default,
-- so viewers never get in editors' way; the document's owner or an editor turns it on.
alter table public.service_objects
  add column live_viewer_cursors boolean not null default false;

create function public.set_live_collab(ws uuid, enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
                 and m.status = 'active' and m.role = 'owner') then
    return public.page_error('forbidden');
  end if;
  update public.workspaces set live_collab = coalesce(enabled, false) where id = ws;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_live_collab(uuid, boolean) from public, anon;
grant execute on function public.set_live_collab(uuid, boolean) to authenticated;

create function public.set_live_viewer_cursors(target_object uuid, enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.service_objects o where o.id = target_object and o.deleted_at is null)
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.service_objects set live_viewer_cursors = coalesce(enabled, false) where id = target_object;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_live_viewer_cursors(uuid, boolean) from public, anon;
grant execute on function public.set_live_viewer_cursors(uuid, boolean) to authenticated;

-- A live channel is "live:<object id>:doc" or "live:<object id>:room". Realtime asks on
-- every join and every new token (not per message):
--   reading — anyone who may open the document;
--   "doc" — sending changes only for the document's owner and editors;
--   "room" — presence for anyone who may open it; cursors (broadcast) for editors, and
--            for viewers and commenters only while the document shows their cursors.
-- Only for presentations and boards ("Design", idea boards), only while the workspace
-- has co-editing on, never for a document in the bin.
create function public.live_channel_allowed(topic text, ext text, want_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := regexp_match(coalesce(topic, ''), '^live:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(doc|room)$');
  object public.service_objects;
  role text;
begin
  if parts is null or auth.uid() is null then
    return false;
  end if;
  select * into object from public.service_objects o where o.id = parts[1]::uuid;
  if not found or object.deleted_at is not null or object.service not in ('slides', 'boards')
     or not coalesce((select w.live_collab from public.workspaces w where w.id = object.workspace_id), false) then
    return false;
  end if;
  role := public.service_object_role(object.id);
  if role is null then
    return false;
  end if;
  if not coalesce(want_write, false) then
    return true;
  end if;
  if parts[2] = 'doc' then
    return ext = 'broadcast' and public.role_rank(role) >= public.role_rank('editor');
  end if;
  return ext = 'presence'
      or (ext = 'broadcast' and (public.role_rank(role) >= public.role_rank('editor') or object.live_viewer_cursors));
end;
$$;
revoke execute on function public.live_channel_allowed(text, text, boolean) from public, anon;
grant execute on function public.live_channel_allowed(text, text, boolean) to authenticated;

-- Realtime keeps its own table; where it is not there yet, private channels simply stay closed.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    create policy edgeknow_live_read on realtime.messages for select to authenticated
      using (public.live_channel_allowed(realtime.topic(), extension, false));
    create policy edgeknow_live_write on realtime.messages for insert to authenticated
      with check (public.live_channel_allowed(realtime.topic(), extension, true));
  end if;
end $$;

-- The team database's copy carries the switch (supabase/team/migrations/0070_live_collab.sql).
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
      select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok'),
      'live_collab', (select w.live_collab from public.workspaces w where w.id = ws)),
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
