-- Undo 20261116100000_platform_guard.sql: no more freezing, limits or "own database first";
-- frozen workspaces open again.
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
  );
$function$

;

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
$function$

;

CREATE OR REPLACE FUNCTION public.create_workspace(new_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cleaned text := trim(coalesce(new_name, ''));
  ws public.workspaces;
begin
  if not public.has_platform_access() then
    return public.ws_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 80 then
    return public.ws_error('invalid_name');
  end if;

  insert into public.workspaces (name, owner_id, created_by)
  values (cleaned, auth.uid(), auth.uid())
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role, joined_via)
  values (ws.id, auth.uid(), 'owner', 'creator');

  perform public.log_workspace_action(ws.id, 'workspace_created', jsonb_build_object('name', cleaned));
  perform public.log_workspace_action(null, 'workspace_created',
    jsonb_build_object('workspace_id', ws.id, 'name', cleaned));
  return jsonb_build_object('ok', true, 'id', ws.id, 'short_id', ws.short_id);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_open_registration(open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied',
      jsonb_build_object('attempted', 'set_open_registration'));
    return public.ws_error('forbidden');
  end if;
  update public.platform_settings
  set open_registration = open,
      email_domain_proof = case when open then false else email_domain_proof end,
      updated_at = now(), updated_by = auth.uid()
  -- The single settings row (Supabase refuses an UPDATE without WHERE).
  where id;
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$function$

;

create or replace function public.has_platform_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_email() is not null and (
    exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    )
    or (select open_registration from public.platform_settings)
  );
$$;
drop function public.platform_workspaces();
CREATE FUNCTION public.platform_workspaces()
 RETURNS TABLE(id uuid, short_id text, name text, owner_email text, members bigint, pages bigint, storage_bytes bigint, storage_limit_mb integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      w.created_at
    from public.workspaces w
    join public.profiles o on o.id = w.owner_id
    order by w.created_at;
end;
$function$

;
revoke execute on function public.platform_workspaces() from public, anon;
grant execute on function public.platform_workspaces() to authenticated;
drop function if exists public.platform_database_size();
drop function if exists public.platform_freeze_workspace(uuid, boolean, text);
drop function if exists public.platform_set_central_allowed(uuid, boolean);
drop function if exists public.set_require_team_database(boolean);
drop function if exists public.central_pages_allowed(uuid);
drop function if exists public.frozen_workspace_notice(text);
alter table public.workspaces
  drop column if exists frozen_reason,
  drop column if exists frozen_at,
  drop column if exists central_allowed;
alter table public.platform_settings drop column if exists require_team_database;
