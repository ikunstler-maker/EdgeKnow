-- Undo 20261207100000_platform_privacy.sql: names and emails for every workspace again.

create or replace function public.platform_workspaces()
returns table (
  id uuid, short_id text, name text, owner_email text, members bigint, pages bigint,
  storage_bytes bigint, storage_limit_mb integer, created_at timestamptz,
  data_location text, central_allowed boolean, frozen_at timestamptz, frozen_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    return;
  end if;
  return query
    select
      w.id, w.short_id, w.name, o.email,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
      (select count(*) from public.pages p where p.workspace_id = w.id),
      (select coalesce(sum(a.bytes), 0)::bigint from public.attachments a where a.workspace_id = w.id),
      w.storage_limit_mb,
      w.created_at,
      (select case when t.setup_step is null or t.setup_step = 'done' then 'team' else 'setup' end
       from public.team_databases t where t.workspace_id = w.id),
      w.central_allowed,
      w.frozen_at,
      w.frozen_reason
    from public.workspaces w
    join public.profiles o on o.id = w.owner_id
    order by w.created_at;
end;
$$;
