-- Before open registration (stage 2): keep the central database small and the
-- platform safe.
--   * "Own database first": with platform_settings.require_team_database on, a
--     workspace makes pages only in its team's own database (path C). Existing
--     workspaces and those made by the platform admin keep the central database
--     (workspaces.central_allowed). Opening registration turns it on.
--   * Freezing: the platform admin can freeze a workspace (abuse); nobody gets
--     in until it is unfrozen, its members only see why.
--   * Limits on making workspaces: 5 a day and 20 owned per person.
--   * The size of the central database for the platform panel.
-- Rollback: supabase/rollbacks/20261116100000_platform_guard.down.sql

alter table public.platform_settings
  add column require_team_database boolean not null default false;

alter table public.workspaces
  add column central_allowed boolean not null default false,
  add column frozen_at timestamptz,
  add column frozen_reason text check (char_length(frozen_reason) <= 500);
-- Everything that exists now keeps working as it does.
update public.workspaces set central_allowed = true;

-- A frozen workspace has no members for the time being.
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

-- For a member of a frozen workspace: its name and the reason (nothing else).
create function public.frozen_workspace_notice(ws_short_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', w.name, 'reason', w.frozen_reason, 'frozen_at', w.frozen_at)
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and m.user_id = auth.uid() and m.status = 'active'
  where w.short_id = ws_short_id and w.frozen_at is not null;
$$;

-- Pages in the central database only where that is allowed.
create function public.central_pages_allowed(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (select s.require_team_database from public.platform_settings s)
      or coalesce((select w.central_allowed from public.workspaces w where w.id = ws), false);
$$;

create or replace function public.create_page(ws uuid, parent uuid, new_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Making workspaces: a few a day, a reasonable number in all (the platform admin has no limit).
create or replace function public.create_workspace(new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := trim(coalesce(new_name, ''));
  ws public.workspaces;
  admin boolean := public.is_platform_admin();
begin
  if not public.has_platform_access() then
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;
  if not admin then
    if (select count(*) from public.workspaces w where w.created_by = auth.uid() and w.created_at > now() - interval '1 day') >= 5 then
      return public.ws_error('too_many_today');
    end if;
    if (select count(*) from public.workspaces w where w.owner_id = auth.uid()) >= 20 then
      return public.ws_error('too_many_workspaces');
    end if;
  end if;

  insert into public.workspaces (name, owner_id, created_by, central_allowed)
  values (cleaned, auth.uid(), auth.uid(), admin)
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  values (ws.id, auth.uid(), 'owner', 'creator');

  perform public.log_workspace_action(ws.id, 'workspace_created', jsonb_build_object('name', cleaned));
  perform public.log_workspace_action(null, 'workspace_created',
    jsonb_build_object('workspace_id', ws.id, 'name', cleaned));
  return jsonb_build_object('ok', true, 'id', ws.id, 'short_id', ws.short_id);
end;
$$;

-- Opening registration ends the instant email way for domains and turns "own database first" on.
create or replace function public.set_open_registration(open boolean)
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
  set open_registration = open,
      email_domain_proof = case when open then false else email_domain_proof end,
      require_team_database = case when open then true else require_team_database end,
      updated_at = now(), updated_by = auth.uid()
  -- The single settings row (Supabase refuses an UPDATE without WHERE).
  where id;
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- The platform admin's switches
-------------------------------------------------------------------------------

create function public.set_require_team_database(required boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied', jsonb_build_object('attempted', 'set_require_team_database'));
    return public.ws_error('forbidden');
  end if;
  update public.platform_settings set require_team_database = required, updated_at = now(), updated_by = auth.uid() where id;
  perform public.log_workspace_action(null,
    case when required then 'team_database_required' else 'team_database_optional' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.platform_set_central_allowed(ws uuid, allowed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied', jsonb_build_object('attempted', 'platform_set_central_allowed'));
    return public.ws_error('forbidden');
  end if;
  update public.workspaces set central_allowed = allowed where id = ws;
  if not found then
    return public.ws_error('not_found');
  end if;
  perform public.log_workspace_action(null, case when allowed then 'central_allowed' else 'central_not_allowed' end,
    jsonb_build_object('workspace_id', ws));
  return jsonb_build_object('ok', true);
end;
$$;

-- Freeze (with a reason the members see) or unfreeze a workspace.
create function public.platform_freeze_workspace(ws uuid, frozen boolean, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied', jsonb_build_object('attempted', 'platform_freeze_workspace'));
    return public.ws_error('forbidden');
  end if;
  update public.workspaces
  set frozen_at = case when frozen then now() end,
      frozen_reason = case when frozen then nullif(btrim(left(coalesce(reason, ''), 500)), '') end
  where id = ws;
  if not found then
    return public.ws_error('not_found');
  end if;
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (ws, auth.uid(), case when frozen then 'workspace_frozen' else 'workspace_unfrozen' end,
          jsonb_build_object('reason', reason));
  perform public.log_workspace_action(null, case when frozen then 'workspace_frozen' else 'workspace_unfrozen' end,
    jsonb_build_object('workspace_id', ws));
  return jsonb_build_object('ok', true);
end;
$$;

-- How big the central database is (the free Supabase plan has 500 MB, files 1 GB).
create function public.platform_database_size()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_platform_admin() then jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0)
  ) end;
$$;

-- The statistics table, now with where each workspace keeps its data and whether it is frozen.
drop function public.platform_workspaces();
create function public.platform_workspaces()
returns table (
  id uuid, short_id text, name text, owner_email text, members bigint, pages bigint,
  storage_bytes bigint, storage_limit_mb integer, created_at timestamptz,
  data_location text, central_allowed boolean, frozen_at timestamptz, frozen_reason text
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
      (select coalesce(sum(a.bytes), 0)::bigint from public.attachments a where a.workspace_id = w.id),
      w.storage_limit_mb,
      w.created_at,
      (select case when t.setup_step is null or t.setup_step = 'done' then 'team' else 'setup' end
       from public.team_databases t where t.workspace_id = w.id),
      w.central_allowed,
      w.frozen_at,
      w.frozen_reason
    from public.workspaces w
    join public.profiles o on o.id = w.owner_id
    order by w.created_at;
end;
$$;

revoke execute on function
  public.frozen_workspace_notice(text),
  public.central_pages_allowed(uuid),
  public.set_require_team_database(boolean),
  public.platform_set_central_allowed(uuid, boolean),
  public.platform_freeze_workspace(uuid, boolean, text),
  public.platform_database_size(),
  public.platform_workspaces()
from public, anon;
grant execute on function
  public.frozen_workspace_notice(text),
  public.central_pages_allowed(uuid),
  public.set_require_team_database(boolean),
  public.platform_set_central_allowed(uuid, boolean),
  public.platform_freeze_workspace(uuid, boolean, text),
  public.platform_database_size(),
  public.platform_workspaces()
to authenticated;
