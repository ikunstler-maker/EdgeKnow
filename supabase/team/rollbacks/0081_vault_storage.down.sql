-- Undo team migration 0081_vault_storage.

drop function public.vault_storage_usage(uuid);

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
    select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', x.name, 'email', x.email, 'pages', x.pages)
             order by x.email)
    from (
      select p.owner_id, pr.name, pr.email, count(*) as pages
      from public.pages p
      join public.profiles pr on pr.id = p.owner_id
      where p.workspace_id = ws and not public.is_active_member(ws, p.owner_id)
      group by p.owner_id, pr.name, pr.email
    ) x
  ), '[]'::jsonb));
end;
$$;

create or replace function public.reassign_member_pages(ws uuid, from_user uuid, to_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
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
  perform public.log_workspace_action(ws, 'pages_reassigned', jsonb_build_object(
    'from', (select email from public.profiles where id = from_user),
    'to', (select email from public.profiles where id = to_user),
    'pages', moved));
  return jsonb_build_object('ok', true, 'pages', moved);
end;
$$;
