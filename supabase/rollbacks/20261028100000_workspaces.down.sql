-- Undo 20261028100000_workspaces.sql. Run after the drop_legacy, workspace_auth
-- and pages_workspace rollbacks; drop_legacy's rollback has already restored
-- allowed_domains / admin_audit_log / profiles.is_admin, so stage 1 behaviour
-- comes back as it was.

drop policy if exists "Users can read profiles of people in their workspaces" on public.profiles;

create or replace function public.is_allowed_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.allowed_domains d on d.domain = public.email_domain(u.email) and d.is_active
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create policy "Allowed users can read profiles"
  on public.profiles for select to authenticated
  using (public.is_allowed_user());

drop table if exists
  public.public_email_domains,
  public.audit_log,
  public.invitations,
  public.workspace_domains,
  public.workspace_members,
  public.workspaces,
  public.platform_settings;

drop function if exists
  public.log_workspace_action(uuid, text, jsonb),
  public.shares_workspace_with(uuid),
  public.has_platform_access(),
  public.is_platform_admin(),
  public.is_workspace_admin(uuid),
  public.workspace_role(uuid),
  public.is_workspace_member(uuid),
  public.current_email();

drop function if exists public.generate_short_id();
alter table public.profiles drop column if exists is_platform_admin;
