-- Path C, step 1.3: the central registry of team databases.
--
-- A workspace may live in its team's own Supabase project. The central service
-- keeps how to reach it (keys encrypted by the server, like the Drive access),
-- which team migrations it has, and copies the workspace and its members there.
-- Server-only: no policy or function hands any of it to a signed-in user.
-- Rollback: supabase/rollbacks/20261109100000_team_databases.down.sql

create table public.team_databases (
  workspace_id          uuid primary key references public.workspaces (id) on delete cascade,
  project_url           text not null check (project_url ~ '^https?://[^/\s]+$'),
  publishable_key       text not null,
  -- Encrypted by the server (AES-256-GCM); never readable by users.
  secret_key_encrypted  text not null,
  -- How migrations reach the database until the Supabase OAuth app (step 1.5).
  db_url_encrypted      text,
  schema_version        text,
  status                text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  last_error            text,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now()
);

alter table public.team_databases enable row level security;
revoke all on public.team_databases from anon, authenticated;

-- What the team database needs to know: the workspace, its effective members
-- (a domain member only while the domain is active) and their names.
create function public.team_sync_payload(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility
    from public.workspace_members m
    where m.workspace_id = ws and m.status = 'active'
      and (m.joined_via <> 'domain' or exists (
        select 1 from public.workspace_domains d join public.profiles p on p.id = m.user_id
        where d.workspace_id = ws and d.is_active and d.domain = public.email_domain(p.email)
      ))
  )
  select jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'short_id', w.short_id, 'name', w.name, 'owner_id', w.owner_id,
                                            'storage_limit_mb', w.storage_limit_mb, 'created_at', w.created_at)
                  from public.workspaces w where w.id = ws),
    'settings', jsonb_build_object('files_on_drive', exists (
      select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok')),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url) order by p.id)
                          from public.profiles p where p.id in (select user_id from members)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_via', m.joined_via,
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility) order by m.user_id)
                         from members m), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;

revoke execute on function public.team_sync_payload(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.team_databases to service_role;
    grant execute on function public.team_sync_payload(uuid) to service_role;
  end if;
end;
$$;
