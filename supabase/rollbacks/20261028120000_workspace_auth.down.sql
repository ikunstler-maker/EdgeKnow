-- Undo 20261028120000_workspace_auth.sql: workspace actions and the new sign-in hook.

drop function if exists
  public.set_open_registration(boolean),
  public.platform_workspaces(),
  public.remove_member(uuid, uuid),
  public.set_member_role(uuid, uuid, text),
  public.revoke_invitation(uuid, uuid),
  public.invite_member(uuid, text, text),
  public.remove_workspace_domain(uuid, text),
  public.set_workspace_domain_active(uuid, text, boolean),
  public.add_workspace_domain(uuid, text),
  public.admin_keeps_access_without(uuid, text),
  public.delete_workspace(uuid, text),
  public.transfer_workspace_ownership(uuid, uuid),
  public.rename_workspace(uuid, text),
  public.create_workspace(text),
  public.invitation_preview(text),
  public.workspace_login_hint(text),
  public.join_workspaces(),
  public.hash_token(text),
  public.is_valid_domain(text),
  public.ws_error(text);

-- Restore the stage 1 hook (domains from the legacy allowed_domains list).
create or replace function public.hook_before_user_created(event jsonb)
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
    'error', jsonb_build_object('http_code', 403, 'message', 'domain_not_allowed')
  );
end;
$$;
