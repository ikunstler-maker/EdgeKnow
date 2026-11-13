-- Undo 0084_core_live_nodes: channels for presentations and Bordy files only.

create or replace function public.live_channel_allowed(topic text, ext text, want_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := regexp_match(coalesce(topic, ''), '^live:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(doc|room)$');
  settings public.team_settings;
  object public.service_objects;
  role text;
begin
  select * into settings from public.team_settings;
  if parts is null or auth.uid() is null or not coalesce(settings.live_collab, false)
     or settings.issuer is null or settings.workspace_id is null
     or coalesce(auth.jwt() ->> 'iss', '') <> settings.issuer
     or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(auth.jwt() ->> 'ek_workspace', '') <> settings.workspace_id::text then
    return false;
  end if;
  select * into object from public.service_objects o where o.id = parts[1]::uuid;
  if not found or object.deleted_at is not null or object.service not in ('slides', 'boards')
     or object.workspace_id <> settings.workspace_id then
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
