-- Workspaces (M4): removes what the pre-workspace app needed, now that the new
-- version runs in production. Its data already lives in workspace_domains,
-- audit_log and workspace_members (copied in 20261028100000_workspaces.sql).
-- Rollback: supabase/rollbacks/20261029100000_drop_legacy.down.sql

-- Tables first: their policies depend on the functions below.
drop table public.allowed_domains;
drop table public.admin_audit_log;
alter table public.profiles drop column is_admin;

-- Stage 1 admin actions on the global domain list.
drop function public.admin_add_domain(text);
drop function public.admin_set_domain_active(text, boolean);
drop function public.admin_remove_domain(text);
drop function public.admin_remains_without(text);
drop function public.log_admin_action(text, jsonb);
drop function public.login_domain_hint();
drop function public.is_admin();

-- Compatibility shims kept for the old app during the deploy.
drop function public.is_allowed_user();
drop function public.create_page(uuid, text);

