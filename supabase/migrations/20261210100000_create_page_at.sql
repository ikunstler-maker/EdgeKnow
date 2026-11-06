-- Wiki: a page made in the browser at once, with the id the browser chose
-- (a random UUID); the database keeps every check of create_page.
-- Rollback: supabase/rollbacks/20261210100000_create_page_at.down.sql

create function public.create_page_at(ws uuid, parent uuid, new_title text, page_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if page_id is null then
    return public.page_error('invalid');
  end if;
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- A retry of the same request (the browser already shows this page): the same answer again.
  if exists (select 1 from public.pages p where p.id = page_id) then
    if exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = ws and p.created_by = auth.uid()) then
      return jsonb_build_object('ok', true, 'id', page_id);
    end if;
    return public.page_error('forbidden');
  end if;
  -- "Own database first": this workspace connects its team's Supabase before it has pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
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

  insert into public.pages (id, workspace_id, parent_id, owner_id, created_by, title, updated_by)
  values (page_id, ws, parent, case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(),
          trim(coalesce(new_title, '')), auth.uid())
  returning id into new_id;
  -- A guest's page belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.page_access (workspace_id, page_id, user_id, role, granted_by)
    values (ws, new_id, auth.uid(), 'editor', auth.uid());
  end if;

  perform public.place_page(new_id, parent, null);
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

revoke execute on function public.create_page_at(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_page_at(uuid, uuid, text, uuid) to authenticated;
