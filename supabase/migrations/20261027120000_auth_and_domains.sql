-- Stage 1: sign-in restricted to allowed email domains, user profiles, admin audit log.
--
-- Rules of thumb used across all migrations:
--   * RLS is enabled on every table; a table without a policy returns nothing.
--   * Tables are never written directly from the client. Writes go through
--     SECURITY DEFINER functions that check permissions and write the audit log.
--   * Every function pins search_path to '' and uses fully qualified names.
--   * Supabase grants EXECUTE on new functions to anon/authenticated by default,
--     so each function revokes those explicitly and re-grants only what is needed.

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text,
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.allowed_domains (
  domain     text primary key
             check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  is_active  boolean not null default true,
  added_by   uuid references public.profiles (id) on delete set null,
  added_at   timestamptz not null default now()
);

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

-- Initial data only: the list is managed from the admin settings page afterwards.
insert into public.allowed_domains (domain) values ('iyo.gg');

alter table public.profiles        enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.admin_audit_log enable row level security;

-- Defense in depth: the client only ever reads these tables.
revoke all on public.profiles, public.allowed_domains, public.admin_audit_log from anon;
revoke insert, update, delete, truncate
  on public.profiles, public.allowed_domains, public.admin_audit_log from authenticated;

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

create function public.email_domain(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(split_part(coalesce(email, ''), '@', 2));
$$;

-- True when the current user has a verified email whose domain is active.
-- Checked on every request (proxy) and inside every RLS policy, so removing or
-- disabling a domain cuts its users off on their next request.
create function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.allowed_domains d
      on d.domain = public.email_domain(u.email) and d.is_active
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_allowed_user()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

-- Google `hd` hint for the login screen: the domain, but only when exactly one is active.
create function public.login_domain_hint()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then min(domain) end
  from public.allowed_domains
  where is_active;
$$;

-------------------------------------------------------------------------------
-- Auth: reject sign-ups from domains outside the list (Before User Created hook)
-------------------------------------------------------------------------------

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_domain text := public.email_domain(event -> 'user' ->> 'email');
begin
  if user_domain <> '' and exists (
    select 1 from public.allowed_domains where domain = user_domain and is_active
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'domain_not_allowed'
    )
  );
end;
$$;

-------------------------------------------------------------------------------
-- Profiles are created and kept in sync from auth.users
-------------------------------------------------------------------------------

create function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        name       = excluded.name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.sync_profile_from_auth_user();

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth_user();

-------------------------------------------------------------------------------
-- Admin actions on allowed domains
--
-- They return {"ok": true} or {"ok": false, "error": "<code>"} instead of raising,
-- so that a denied attempt is still committed to the audit log.
-------------------------------------------------------------------------------

create function public.log_admin_action(action text, details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_id, action, details)
  values (auth.uid(), action, details);
$$;

-- Would at least one active admin still be able to sign in if `excluded_domain` went away?
create function public.admin_remains_without(excluded_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.allowed_domains d
      on d.domain = public.email_domain(p.email) and d.is_active
    where p.is_admin
      and d.domain <> excluded_domain
  );
$$;

create function public.admin_add_domain(new_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(new_domain));
begin
  if not public.is_admin() then
    perform public.log_admin_action('access_denied',
      jsonb_build_object('attempted', 'add_domain', 'domain', normalized));
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if normalized !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_domain');
  end if;

  if exists (select 1 from public.allowed_domains where domain = normalized) then
    return jsonb_build_object('ok', false, 'error', 'already_exists');
  end if;

  insert into public.allowed_domains (domain, added_by) values (normalized, auth.uid());
  perform public.log_admin_action('domain_added', jsonb_build_object('domain', normalized));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_set_domain_active(target_domain text, active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    perform public.log_admin_action('access_denied',
      jsonb_build_object('attempted', 'set_domain_active', 'domain', target_domain, 'active', active));
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.allowed_domains where domain = target_domain) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not active and not public.admin_remains_without(target_domain) then
    return jsonb_build_object('ok', false, 'error', 'last_admin_domain');
  end if;

  update public.allowed_domains set is_active = active where domain = target_domain;
  perform public.log_admin_action(
    case when active then 'domain_enabled' else 'domain_disabled' end,
    jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_remove_domain(target_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    perform public.log_admin_action('access_denied',
      jsonb_build_object('attempted', 'remove_domain', 'domain', target_domain));
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.allowed_domains where domain = target_domain) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.admin_remains_without(target_domain) then
    return jsonb_build_object('ok', false, 'error', 'last_admin_domain');
  end if;

  delete from public.allowed_domains where domain = target_domain;
  perform public.log_admin_action('domain_removed', jsonb_build_object('domain', target_domain));
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.email_domain(text),
  public.is_allowed_user(),
  public.is_admin(),
  public.login_domain_hint(),
  public.hook_before_user_created(jsonb),
  public.sync_profile_from_auth_user(),
  public.log_admin_action(text, jsonb),
  public.admin_remains_without(text),
  public.admin_add_domain(text),
  public.admin_set_domain_active(text, boolean),
  public.admin_remove_domain(text)
from public, anon, authenticated;

grant execute on function public.login_domain_hint() to anon, authenticated;
grant execute on function
  public.email_domain(text),
  public.is_allowed_user(),
  public.is_admin(),
  public.admin_add_domain(text),
  public.admin_set_domain_active(text, boolean),
  public.admin_remove_domain(text)
to authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-------------------------------------------------------------------------------
-- RLS policies
-------------------------------------------------------------------------------

create policy "Allowed users can read profiles"
  on public.profiles for select
  to authenticated
  using (public.is_allowed_user());

create policy "Admins can read allowed domains"
  on public.allowed_domains for select
  to authenticated
  using (public.is_admin());

create policy "Admins can read the audit log"
  on public.admin_audit_log for select
  to authenticated
  using (public.is_admin());
