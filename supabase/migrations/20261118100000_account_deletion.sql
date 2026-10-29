-- A person deletes their own account (GDPR, stage 2). The EdgeKnow server
-- checks who is asking and the typed confirmation, tidies the team databases,
-- calls this, and then removes the sign-in account; deleting it removes the
-- profile, memberships, own grants and statistics, and leaves comments and
-- history as "former member".
-- Rollback: supabase/rollbacks/20261118100000_account_deletion.down.sql

create function public.account_deletion_cleanup(person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned jsonb;
  mail text := (select p.email from public.profiles p where p.id = person);
begin
  if mail is null then
    return public.ws_error('not_found');
  end if;
  -- A workspace needs its owner: hand it over or delete it first.
  select jsonb_agg(w.name order by w.name) into owned from public.workspaces w where w.owner_id = person;
  if owned is not null then
    return jsonb_build_object('ok', false, 'error', 'owns_workspaces', 'workspaces', owned);
  end if;
  -- Their pages stay with the team: the workspace owner gets them, as for a member who left.
  update public.pages p set owner_id = w.owner_id
  from public.workspaces w
  where p.owner_id = person and w.id = p.workspace_id;
  delete from public.invitations where lower(email) = lower(mail);
  delete from public.rate_limits where user_id = person;
  insert into public.audit_log (workspace_id, actor_id, action, details) values (null, null, 'account_deleted', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.account_deletion_cleanup(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.account_deletion_cleanup(uuid) to service_role;
  end if;
end;
$$;
