-- Domains proven through DNS (stage 1, self-administration). A workspace admin
-- asks for a domain, gets a TXT record to add at _edgeknow.<domain>, and the
-- EdgeKnow server checks DNS and confirms it. Only confirmed domains are in
-- workspace_domains, so everything that lets people in by their email domain
-- (sign-up, joining, membership, the team sync) is unchanged.
--
-- How a domain got there (method):
--   legacy — added before this step (kept as it is, the pilot's own domain);
--   email  — the admin's own email domain, the old instant way; allowed only
--            while platform_settings.email_domain_proof is on, and handed over
--            to a workspace that proves the domain through DNS;
--   dns    — proven through DNS;
--   admin  — confirmed by the platform admin by hand.
-- Opening registration from the platform panel turns the email way off.
-- Rollback: supabase/rollbacks/20261114100000_domain_dns.down.sql

alter table public.workspace_domains
  add column method text not null default 'legacy' check (method in ('legacy', 'email', 'dns', 'admin')),
  -- The TXT value it was proven with, for the weekly look that it is still there.
  add column dns_token text,
  add column dns_checked_at timestamptz,
  add column dns_missing_since timestamptz;

alter table public.platform_settings
  add column email_domain_proof boolean not null default true;

-- Requests to prove a domain; several workspaces may ask for the same one, the
-- first to prove it gets it.
create table public.workspace_domain_claims (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  domain        text not null
                check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  token         text not null default replace(gen_random_uuid()::text, '-', ''),
  requested_by  uuid references public.profiles (id) on delete set null,
  requested_at  timestamptz not null default now(),
  checked_at    timestamptz,
  last_error    text,
  primary key (workspace_id, domain)
);
alter table public.workspace_domain_claims enable row level security;
revoke all on public.workspace_domain_claims from public, anon, authenticated;
grant select on public.workspace_domain_claims to authenticated;
create policy "Admins can read their workspace's domain requests"
  on public.workspace_domain_claims for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.is_workspace_admin(workspace_id));

-- The old instant way, now marked and switchable.
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
  if not (select s.email_domain_proof from public.platform_settings s) then
    return public.ws_error('dns_required');
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

  insert into public.workspace_domains (domain, workspace_id, verified, added_by, method)
  values (normalized, ws, true, auth.uid(), 'email');
  perform public.log_workspace_action(ws, 'domain_added', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ask to prove a domain: returns the TXT value to publish.
create function public.request_workspace_domain(ws uuid, new_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(new_domain, '')));
  holder public.workspace_domains;
  claim public.workspace_domain_claims;
begin
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'request_domain', 'domain', normalized));
    return public.ws_error('forbidden');
  end if;
  if not public.is_valid_domain(normalized) then
    return public.ws_error('invalid_domain');
  end if;
  if exists (select 1 from public.public_email_domains where domain = normalized) then
    return public.ws_error('public_domain');
  end if;
  select * into holder from public.workspace_domains where domain = normalized;
  if found and holder.workspace_id = ws then
    return public.ws_error('already_yours');
  end if;
  -- Proven domains stay where they are; only one added the old instant way can be taken over.
  if found and holder.method <> 'email' then
    return public.ws_error('domain_taken');
  end if;
  insert into public.workspace_domain_claims (workspace_id, domain, requested_by)
  values (ws, normalized, auth.uid())
  on conflict (workspace_id, domain) do update set requested_at = public.workspace_domain_claims.requested_at
  returning * into claim;
  perform public.log_workspace_action(ws, 'domain_requested', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true, 'domain', normalized, 'record', '_edgeknow.' || normalized, 'value', 'edgeknow-verify=' || claim.token);
end;
$$;

create function public.cancel_workspace_domain_request(ws uuid, target_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    return public.ws_error('forbidden');
  end if;
  delete from public.workspace_domain_claims where workspace_id = ws and domain = target_domain;
  return jsonb_build_object('ok', true);
end;
$$;

-- Called by the EdgeKnow server (secret key) after it found the TXT record, or
-- with method 'admin' by the platform admin. Hands an instantly added domain
-- over; its people who came through it leave that workspace with it.
create function public.confirm_workspace_domain(ws uuid, target_domain text, how text, actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  holder public.workspace_domains;
  claim public.workspace_domain_claims;
begin
  if how not in ('dns', 'admin') then
    return public.ws_error('invalid');
  end if;
  select * into claim from public.workspace_domain_claims where workspace_id = ws and domain = target_domain;
  if not found then
    return public.ws_error('not_found');
  end if;
  select * into holder from public.workspace_domains where domain = target_domain for update;
  if found and holder.workspace_id <> ws and holder.method <> 'email' then
    return public.ws_error('domain_taken');
  end if;
  if found and holder.workspace_id <> ws then
    delete from public.workspace_domains where domain = target_domain;
    insert into public.audit_log (workspace_id, actor_id, action, details)
    values (holder.workspace_id, actor, 'domain_taken_over', jsonb_build_object('domain', target_domain));
  end if;
  insert into public.workspace_domains (domain, workspace_id, verified, added_by, method, dns_token, dns_checked_at)
  values (target_domain, ws, true, actor, how, case when how = 'dns' then claim.token end, case when how = 'dns' then now() end)
  on conflict (domain) do update
    set method = excluded.method, dns_token = excluded.dns_token, dns_checked_at = excluded.dns_checked_at, dns_missing_since = null;
  delete from public.workspace_domain_claims where domain = target_domain;
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (ws, actor, 'domain_verified', jsonb_build_object('domain', target_domain, 'method', how));
  return jsonb_build_object('ok', true);
end;
$$;

-- The platform admin confirms a requested domain by hand (the team's IT won't
-- add the record, and the admin knows the team is genuine).
create function public.platform_confirm_domain(ws uuid, target_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied',
      jsonb_build_object('attempted', 'platform_confirm_domain', 'domain', target_domain));
    return public.ws_error('forbidden');
  end if;
  return public.confirm_workspace_domain(ws, target_domain, 'admin', auth.uid());
end;
$$;

-- Requests waiting for proof, for the platform panel (no page contents).
create function public.platform_domain_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_platform_admin() then coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', c.workspace_id, 'workspace', w.name, 'domain', c.domain,
    'requested_by', p.email, 'requested_at', c.requested_at, 'last_error', c.last_error,
    'held_by', (select w2.name from public.workspace_domains d join public.workspaces w2 on w2.id = d.workspace_id where d.domain = c.domain)
  ) order by c.requested_at), '[]') end
  from public.workspace_domain_claims c
  join public.workspaces w on w.id = c.workspace_id
  left join public.profiles p on p.id = c.requested_by;
$$;

-- Opening registration ends the instant email way (anyone could then claim their company's domain first).
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
      updated_at = now(), updated_by = auth.uid();
  perform public.log_workspace_action(null,
    case when open then 'registration_opened' else 'registration_closed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- The platform admin's switch for the instant email way.
create function public.set_email_domain_proof(allowed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    perform public.log_workspace_action(null, 'access_denied',
      jsonb_build_object('attempted', 'set_email_domain_proof'));
    return public.ws_error('forbidden');
  end if;
  update public.platform_settings set email_domain_proof = allowed, updated_at = now(), updated_by = auth.uid();
  perform public.log_workspace_action(null,
    case when allowed then 'email_domains_allowed' else 'email_domains_ended' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.set_email_domain_proof(boolean),
  public.request_workspace_domain(uuid, text),
  public.cancel_workspace_domain_request(uuid, text),
  public.confirm_workspace_domain(uuid, text, text, uuid),
  public.platform_confirm_domain(uuid, text),
  public.platform_domain_requests()
from public, anon, authenticated;
grant execute on function
  public.set_email_domain_proof(boolean),
  public.request_workspace_domain(uuid, text),
  public.cancel_workspace_domain_request(uuid, text),
  public.platform_confirm_domain(uuid, text),
  public.platform_domain_requests()
to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.confirm_workspace_domain(uuid, text, text, uuid) to service_role;
    grant select, update on public.workspace_domains, public.workspace_domain_claims to service_role;
  end if;
end;
$$;
