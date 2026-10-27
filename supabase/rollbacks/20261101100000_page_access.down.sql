-- Undo 20261101100000_page_access.sql: back to owner-only pages. Grants,
-- whole-workspace access and "restricted" flags are lost.
drop function if exists public.reassign_member_pages(uuid, uuid, uuid);
drop function if exists public.departed_page_owners(uuid);
drop function if exists public.transfer_page_ownership(uuid, uuid);
drop function if exists public.set_page_inherit(uuid, boolean);
drop function if exists public.set_page_workspace_role(uuid, text);
drop function if exists public.set_page_member_role(uuid, uuid, text);
drop function if exists public.page_sharing(uuid);
drop function if exists public.shared_with_workspace(public.pages);
drop function if exists public.my_role(public.pages);

create or replace function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_workspace_member(p.workspace_id) then null
    when p.owner_id = auth.uid() then 'owner'
  end
  from public.pages p
  where p.id = target_page;
$$;

drop trigger if exists workspace_members_drop_grants on public.workspace_members;
drop table if exists public.page_access;
drop function if exists public.drop_grants_of_removed_member();
drop function if exists public.check_page_access_workspace();
drop function if exists public.access_chain(uuid);
drop function if exists public.is_active_member(uuid, uuid);
drop function if exists public.role_rank(text);
alter table public.pages drop column if exists inherit, drop column if exists workspace_role;
