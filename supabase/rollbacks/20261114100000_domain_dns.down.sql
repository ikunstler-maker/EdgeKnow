-- Undo 20261114100000_domain_dns.sql. Domains proven through DNS or by the
-- platform admin stay (as ordinary domains); open requests are dropped.
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
  set open_registration = open, updated_at = now(), updated_by = auth.uid();
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_workspace_domain(ws uuid, new_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(new_domain, '')));
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'add_domain', 'domain', normalized));
    return public.ws_error('forbidden');
  end if;
  if not public.is_valid_domain(normalized) then
    return public.ws_error('invalid_domain');
  end if;
  if exists (select 1 from public.public_email_domains where domain = normalized) then
    return public.ws_error('public_domain');
  end if;
  if normalized <> public.email_domain(public.current_email()) then
    return public.ws_error('domain_mismatch');
  end if;
  if exists (select 1 from public.workspace_domains where domain = normalized) then
    return public.ws_error('domain_taken');
  end if;

  insert into public.workspace_domains (domain, workspace_id, verified, added_by)
  values (normalized, ws, true, auth.uid());
  perform public.log_workspace_action(ws, 'domain_added', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.set_email_domain_proof(boolean);
drop function if exists public.platform_domain_requests();
drop function if exists public.platform_confirm_domain(uuid, text);
drop function if exists public.confirm_workspace_domain(uuid, text, text, uuid);
drop function if exists public.cancel_workspace_domain_request(uuid, text);
drop function if exists public.request_workspace_domain(uuid, text);
drop table if exists public.workspace_domain_claims;
alter table public.platform_settings drop column if exists email_domain_proof;
alter table public.workspace_domains
  drop column if exists dns_missing_since,
  drop column if exists dns_checked_at,
  drop column if exists dns_token,
  drop column if exists method;
