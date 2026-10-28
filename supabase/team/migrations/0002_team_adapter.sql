-- Turns the baseline into a team database (path C).
--
-- A team database holds one workspace's pages, access, comments, files and
-- statistics. People sign in on the central EdgeKnow service, whose tokens this
-- project trusts (Custom OIDC); the central service also decides who is a
-- member and copies that here (team_sync, secret key only). Domains,
-- invitations, platform settings and Drive access stay central.

-------------------------------------------------------------------------------
-- What only the central service keeps
-------------------------------------------------------------------------------

drop policy "Admins read their log; platform admins read platform events" on public.audit_log;
create policy "Admins read their workspace log"
  on public.audit_log for select to authenticated
  using (workspace_id is not null and public.is_workspace_admin(workspace_id));

alter table public.attachments drop constraint attachments_drive_connection_id_fkey;
alter table public.page_backups drop constraint page_backups_drive_connection_id_fkey;

drop table public.workspace_data_backups;
drop table public.drive_connections;
drop table public.invitations;
drop table public.platform_settings;
drop table public.public_email_domains;

alter table public.workspaces alter column short_id drop default;

drop function public.create_workspace(text);
drop function public.delete_workspace(uuid, text);
drop function public.rename_workspace(uuid, text);
drop function public.transfer_workspace_ownership(uuid, uuid);
drop function public.add_workspace_domain(uuid, text);
drop function public.remove_workspace_domain(uuid, text);
drop function public.set_workspace_domain_active(uuid, text, boolean);
drop function public.invite_member(uuid, text, text);
drop function public.revoke_invitation(uuid, uuid);
drop function public.invitation_preview(text);
drop function public.join_workspaces();
drop function public.set_open_registration(boolean);
drop function public.platform_workspaces();
drop function public.hook_before_user_created(jsonb);
drop function public.sync_profile_from_auth_user();
drop function public.workspace_login_hint(text);
drop function public.has_platform_access();
drop function public.set_my_preferences(text, text);
drop function public.workspace_storage_status(uuid);
drop function public.set_member_role(uuid, uuid, text);
drop function public.remove_member(uuid, uuid);
drop function public.admin_keeps_access_without(uuid, text);
drop function public.hash_token(text);
drop function public.generate_short_id();
drop function public.is_platform_admin();

-- People live centrally: profiles here are copies without sign-in data.
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles drop column is_platform_admin, drop column theme, drop column locale;

-------------------------------------------------------------------------------
-- Who is signed in: the EdgeKnow token
-------------------------------------------------------------------------------

-- The central service puts the verified email into its tokens.
create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(lower(auth.jwt() ->> 'email'), '');
$$;

-- Membership is decided centrally (domains, invitations) and copied here, so a
-- member is simply an active row.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

drop table public.workspace_domains;
drop function public.email_domain(text);
drop function public.is_valid_domain(text);

-------------------------------------------------------------------------------
-- Settings copied from the central service
-------------------------------------------------------------------------------

create table public.team_settings (
  id              boolean primary key default true check (id),
  workspace_id    uuid references public.workspaces (id) on delete cascade,
  -- The only issuer whose tokens may act here, and only as a signed-in person.
  issuer          text,
  -- New files go to the team's Google Drive (the central service holds the access).
  files_on_drive  boolean not null default false,
  updated_at      timestamptz not null default now()
);
alter table public.team_settings enable row level security;
revoke all on public.team_settings from anon, authenticated;
insert into public.team_settings default values;

-- Same as before, except that "Drive connected" now comes from the settings.
create or replace function public.register_attachment(
  target_page uuid,
  file_type text,
  file_bytes integer,
  file_width integer,
  file_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page record;
  used bigint;
  new_id uuid := gen_random_uuid();
  path text;
  on_drive boolean;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  select p.workspace_id, p.deleted_at, w.storage_limit_mb into page
  from public.pages p join public.workspaces w on w.id = p.workspace_id
  where p.id = target_page;
  if page.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if file_type not in ('image/webp', 'image/jpeg', 'image/png', 'image/gif') then
    return public.page_error('unsupported_type');
  end if;
  if file_bytes is null or file_bytes < 1 or file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;

  on_drive := coalesce((select s.files_on_drive from public.team_settings s), false);
  if not on_drive then
    select coalesce(sum(bytes), 0) into used
    from public.attachments where workspace_id = page.workspace_id and storage_backend = 'supabase';
    if used + file_bytes > page.storage_limit_mb::bigint * 1048576 then
      return public.page_error('quota_exceeded');
    end if;
  end if;

  path := page.workspace_id || '/' || target_page || '/' || new_id || '.' ||
    case file_type when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
                   when 'image/png' then 'png' else 'gif' end;
  insert into public.attachments (id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by)
  values (new_id, page.workspace_id, target_page, path, file_type, file_bytes,
          nullif(file_width, 0), nullif(file_height, 0), auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path,
                            'backend', case when on_drive then 'drive' else 'supabase' end);
end;
$$;
revoke execute on function public.register_attachment(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.register_attachment(uuid, text, integer, integer, integer) to authenticated;

-------------------------------------------------------------------------------
-- Copying from the central service (secret key only)
-------------------------------------------------------------------------------

-- One call brings the workspace, the people and the members up to date:
-- { "workspace": {...}, "settings": {...}, "profiles": [...], "members": [...] }.
-- Members missing from "members" are marked removed (their page grants go, as
-- when they are removed centrally).
create function public.team_sync(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws jsonb := payload -> 'workspace';
  ws_id uuid := (ws ->> 'id')::uuid;
begin
  if ws_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if exists (select 1 from public.workspaces w where w.id <> ws_id) then
    -- A team database belongs to exactly one workspace.
    return jsonb_build_object('ok', false, 'error', 'other_workspace');
  end if;

  insert into public.profiles (id, email, name, avatar_url)
  select (p ->> 'id')::uuid, p ->> 'email', p ->> 'name', p ->> 'avatar_url'
  from jsonb_array_elements(coalesce(payload -> 'profiles', '[]')) p
  on conflict (id) do update set email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url;

  insert into public.workspaces (id, short_id, name, owner_id, created_by, storage_limit_mb, created_at)
  values (ws_id, ws ->> 'short_id', ws ->> 'name', (ws ->> 'owner_id')::uuid, (ws ->> 'owner_id')::uuid,
          coalesce((ws ->> 'storage_limit_mb')::integer, 50), coalesce((ws ->> 'created_at')::timestamptz, now()))
  on conflict (id) do update set short_id = excluded.short_id, name = excluded.name,
    owner_id = excluded.owner_id, storage_limit_mb = excluded.storage_limit_mb;

  if payload ? 'members' then
    -- The owner changes hands without two owners at once.
    update public.workspace_members m set role = 'admin'
    where m.workspace_id = ws_id and m.role = 'owner'
      and m.user_id is distinct from (ws ->> 'owner_id')::uuid;
    insert into public.workspace_members (workspace_id, user_id, role, joined_via, status, joined_at, profile_visibility)
    select ws_id, (m ->> 'user_id')::uuid, m ->> 'role', coalesce(m ->> 'joined_via', 'invite'), 'active',
           coalesce((m ->> 'joined_at')::timestamptz, now()), coalesce(m ->> 'profile_visibility', 'private')
    from jsonb_array_elements(payload -> 'members') m
    on conflict (workspace_id, user_id) do update set role = excluded.role, joined_via = excluded.joined_via,
      status = 'active', profile_visibility = excluded.profile_visibility;
    update public.workspace_members m set status = 'removed'
    where m.workspace_id = ws_id and m.status = 'active'
      and not exists (select 1 from jsonb_array_elements(payload -> 'members') x where (x ->> 'user_id')::uuid = m.user_id);
  end if;

  update public.team_settings set
    workspace_id = ws_id,
    issuer = coalesce(payload -> 'settings' ->> 'issuer', issuer),
    files_on_drive = coalesce((payload -> 'settings' ->> 'files_on_drive')::boolean, files_on_drive),
    updated_at = now()
  -- Supabase refuses an UPDATE without WHERE coming through its API.
  where id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.team_sync(jsonb) from public, anon, authenticated;

-- The visibility of a profile is chosen here by the person and copied back centrally.
create function public.team_member_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'profile_visibility', profile_visibility)), '[]')
  from public.workspace_members where status = 'active';
$$;
revoke execute on function public.team_member_settings() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Tokens from EdgeKnow act only as a signed-in person
-------------------------------------------------------------------------------

-- Runs before every API request. Even with a leaked signing key, a token from our
-- issuer can't claim an admin role here.
-- The issuer arrives with the first sync, so connecting a project always runs
-- migrations and the first sync before our sign-in is added to it (step 1.5).
create or replace function public.edgeknow_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ours text := (select s.issuer from public.team_settings s);
begin
  if ours is not null and auth.jwt() ->> 'iss' = ours and coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'EdgeKnow tokens are for signed-in people only' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.edgeknow_guard() to public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.team_sync(jsonb), public.team_member_settings() to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.edgeknow_guard';
    notify pgrst, 'reload config';
  end if;
end;
$$;
