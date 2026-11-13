-- CORE-4: live co-editing, phase 3 — mind maps and flows of Nodo join the private channels
-- (owner's approval 2026-11-13). Same rules as presentations and Bordy files.
-- Rollback: supabase/rollbacks/20270211100000_core_live_nodes.down.sql

create or replace function public.live_channel_allowed(topic text, ext text, want_write boolean)
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
  if not found or object.deleted_at is not null or object.service not in ('slides', 'boards', 'nodes')
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
