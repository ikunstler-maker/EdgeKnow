-- VAULT-4 in a team's own database (as supabase/migrations/20270210100000_vault_storage.sql,
-- without the storage limit: a team's own storage has none of ours).
-- Rollback: supabase/team/rollbacks/0083_vault_storage.down.sql

-- The pages and Vault items of people no longer in the workspace, for the owner and admins.
create or replace function public.departed_page_owners(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'owners', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', x.name, 'email', x.email, 'pages', x.pages, 'files', x.files)
             order by x.email)
    from (
      select o.owner_id, pr.name, pr.email, sum(o.pages)::integer as pages, sum(o.files)::integer as files
      from (
        select p.owner_id, count(*) as pages, 0 as files
        from public.pages p
        where p.workspace_id = ws and not public.is_active_member(ws, p.owner_id)
        group by p.owner_id
        union all
        select i.owner_id, 0, count(*)
        from public.vault_items i
        where i.workspace_id = ws and i.owner_id is not null and not public.is_active_member(ws, i.owner_id)
        group by i.owner_id
      ) o
      join public.profiles pr on pr.id = o.owner_id
      group by o.owner_id, pr.name, pr.email
    ) x
  ), '[]'::jsonb));
end;
$$;

-- Handing over a former member's pages and Vault items to a member (Vault items only to
-- someone who is not a guest: guests never see Vault). The new owner's own grants on what
-- they now own are dropped (owning covers them).
create or replace function public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
  files integer := 0;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not public.is_workspace_admin(ws) then
    perform public.log_workspace_action(ws, 'access_denied',
      jsonb_build_object('attempted', 'reassign_member_pages'));
    return public.page_error('forbidden');
  end if;
  if public.is_active_member(ws, from_user) then
    return public.page_error('still_a_member');
  end if;
  if not public.is_active_member(ws, to_user) then
    return public.page_error('not_a_member');
  end if;

  delete from public.page_access a
  using public.pages p
  where a.page_id = p.id and p.workspace_id = ws and p.owner_id = from_user and a.user_id = to_user;
  update public.pages set owner_id = to_user where workspace_id = ws and owner_id = from_user;
  get diagnostics moved = row_count;
  if not public.is_guest(ws, to_user) then
    delete from public.vault_access a
    using public.vault_items i
    where a.item_id = i.id and i.workspace_id = ws and i.owner_id = from_user and a.user_id = to_user;
    update public.vault_items set owner_id = to_user where workspace_id = ws and owner_id = from_user;
    get diagnostics files = row_count;
  end if;
  perform public.log_workspace_action(ws, 'pages_reassigned', jsonb_build_object(
    'from', (select email from public.profiles where id = from_user),
    'to', (select email from public.profiles where id = to_user),
    'pages', moved, 'files', files));
  return jsonb_build_object('ok', true, 'pages', moved, 'files', files);
end;
$$;

-- What the workspace's files take, by service (owner and admins; sizes only, never names):
-- all of them wherever they are, and how much of that is in this database's own storage.
create function public.vault_storage_usage(ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_workspace_admin(ws), false) then
    return public.ws_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'services', (
    select coalesce(jsonb_object_agg(x.service, jsonb_build_object('bytes', x.bytes, 'stored', x.stored)), '{}'::jsonb)
    from (
      select s.service, sum(s.bytes)::bigint as bytes, sum(s.stored)::bigint as stored
      from (
        select 'wiki' as service, a.bytes::bigint as bytes, case when a.storage_backend = 'supabase' then a.bytes else 0 end::bigint as stored
        from public.attachments a where a.workspace_id = ws
        union all
        select 'tasks', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.task_files f where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select o.service, f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.object_files f join public.service_objects o on o.id = f.object_id
        where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select 'chat', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.chat_files f where f.workspace_id = ws and f.storage_backend <> 'pending'
        union all
        select 'files', f.bytes, case when f.storage_backend = 'supabase' then f.bytes else 0 end
        from public.vault_items f where f.workspace_id = ws and f.kind = 'file' and f.storage_backend <> 'pending'
      ) s
      group by s.service
    ) x));
end;
$$;
revoke execute on function public.vault_storage_usage(uuid) from public, anon;
grant execute on function public.vault_storage_usage(uuid) to authenticated;
