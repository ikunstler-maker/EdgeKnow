-- Undo 20261029100000_drop_legacy.sql: brings back the legacy tables (filled from
-- the first workspace) and the functions the earlier rollbacks rely on.
-- The stage 1 admin_* domain functions are not restored: no app version uses them.

alter table public.profiles add column is_admin boolean not null default false;
update public.profiles p set is_admin = true
where exists (
  select 1 from public.workspace_members m
  where m.user_id = p.id and m.role in ('owner', 'admin') and m.status = 'active'
);

create table public.allowed_domains (
  domain     text primary key
             check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  is_active  boolean not null default true,
  added_by   uuid references public.profiles (id) on delete set null,
  added_at   timestamptz not null default now()
);
insert into public.allowed_domains (domain, is_active, added_by, added_at)
select d.domain, d.is_active, d.added_by, d.added_at
from public.workspace_domains d
where d.workspace_id = (select id from public.workspaces order by created_at limit 1);

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
insert into public.admin_audit_log (actor_id, action, details, created_at)
select actor_id, action, details, created_at
from public.audit_log
where workspace_id = (select id from public.workspaces order by created_at limit 1)
order by id;

alter table public.allowed_domains enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.allowed_domains, public.admin_audit_log from anon;
revoke insert, update, delete, truncate on public.allowed_domains, public.admin_audit_log from authenticated;

create function public.is_allowed_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_platform_access();
$$;
revoke execute on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated;

create function public.create_page(parent uuid default null, new_title text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
begin
  if parent is not null then
    select workspace_id into ws from public.pages where id = parent;
  else
    select m.workspace_id into ws
    from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    order by w.created_at limit 1;
  end if;
  if ws is null then return public.page_error('forbidden'); end if;
  return public.create_page(ws, parent, new_title);
end;
$$;
revoke execute on function public.create_page(uuid, text) from public, anon;
grant execute on function public.create_page(uuid, text) to authenticated;
