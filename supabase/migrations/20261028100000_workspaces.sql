-- Workspaces (M1): isolated team spaces, membership, per-workspace domains,
-- invitations, audit log and platform settings. Moves existing data into the
-- first workspace "iyo".
--
-- Backward compatible: the legacy allowed_domains / admin_audit_log tables and
-- profiles.is_admin stay until 20261028130000_drop_legacy.sql.
-- Rollback: supabase/rollbacks/20261028100000_workspaces.down.sql

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

-- Single-row platform switches.
create table public.platform_settings (
  id                 boolean primary key default true check (id),
  open_registration  boolean not null default false,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null
);
insert into public.platform_settings (id) values (true);

alter table public.profiles add column is_platform_admin boolean not null default false;

-- Short, permanent id used in URLs; the name can change freely.
create function public.generate_short_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(md5(gen_random_uuid()::text), 1, 8);
$$;

create table public.workspaces (
  id                uuid primary key default gen_random_uuid(),
  short_id          text not null unique default public.generate_short_id()
                    check (short_id ~ '^[a-z0-9]{8}$'),
  name              text not null check (char_length(trim(name)) between 1 and 80),
  owner_id          uuid not null references public.profiles (id) on delete restrict,
  created_by        uuid references public.profiles (id) on delete set null,
  plan              text not null default 'free',
  storage_limit_mb  integer not null default 500 check (storage_limit_mb >= 0),
  -- Where the workspace keeps its files. Only 'supabase' is implemented in v1;
  -- 's3' (R2, S3, Backblaze) and 'google_drive' are planned. Secrets never go here.
  storage_backend   text not null default 'supabase'
                    check (storage_backend in ('supabase', 's3', 'google_drive')),
  storage_config    jsonb,
  created_at        timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  -- 'domain' members keep access only while their email domain is active in the workspace.
  joined_via    text not null check (joined_via in ('creator', 'domain', 'invite')),
  -- 'removed' keeps a removed person from rejoining automatically through their domain.
  status        text not null default 'active' check (status in ('active', 'removed')),
  joined_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create unique index workspace_members_one_owner on public.workspace_members (workspace_id)
  where role = 'owner' and status = 'active';
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_domains (
  -- Primary key: one domain can belong to one workspace only.
  domain        text primary key
                check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  is_active     boolean not null default true,
  -- True when proven: the person who added it uses an email on that domain (DNS later).
  verified      boolean not null default false,
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now()
);
create index workspace_domains_workspace_idx on public.workspace_domains (workspace_id);

create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email = lower(email) and email like '%_@_%'),
  role          text not null default 'member' check (role in ('admin', 'member')),
  -- Only a hash of the link token is stored; the token itself is shown once to the admin.
  token_hash    text not null unique,
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz
);
create index invitations_workspace_idx on public.invitations (workspace_id);
create index invitations_email_idx on public.invitations (email) where accepted_at is null and revoked_at is null;

-- workspace_id is null for platform-level events (workspace created / deleted, settings).
create table public.audit_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at desc);

-- Free mail providers can't be used for automatic joining.
create table public.public_email_domains (domain text primary key);
insert into public.public_email_domains (domain) values
  ('gmail.com'), ('googlemail.com'), ('outlook.com'), ('hotmail.com'), ('live.com'),
  ('msn.com'), ('yahoo.com'), ('ymail.com'), ('icloud.com'), ('me.com'), ('mac.com'),
  ('aol.com'), ('proton.me'), ('protonmail.com'), ('pm.me'), ('gmx.com'), ('gmx.net'),
  ('gmx.de'), ('web.de'), ('mail.com'), ('zoho.com'), ('yandex.ru'), ('yandex.com'),
  ('mail.ru'), ('bk.ru'), ('inbox.ru'), ('list.ru'), ('ukr.net'), ('i.ua'), ('meta.ua'),
  ('email.ua'), ('tutanota.com'), ('tuta.io'), ('fastmail.com'), ('hey.com'), ('qq.com'),
  ('163.com'), ('126.com'), ('naver.com'), ('rambler.ru'), ('seznam.cz'), ('wp.pl'),
  ('o2.pl'), ('interia.pl'), ('onet.pl'), ('libero.it'), ('orange.fr'), ('free.fr'),
  ('t-online.de'), ('btinternet.com'), ('comcast.net'), ('verizon.net'), ('att.net');

alter table public.platform_settings    enable row level security;
alter table public.workspaces           enable row level security;
alter table public.workspace_members    enable row level security;
alter table public.workspace_domains    enable row level security;
alter table public.invitations          enable row level security;
alter table public.audit_log            enable row level security;
alter table public.public_email_domains enable row level security;

-- Clients only read these tables (through RLS); every write goes through functions.
revoke all on public.platform_settings, public.workspaces, public.workspace_members,
  public.workspace_domains, public.invitations, public.audit_log, public.public_email_domains
  from anon;
revoke insert, update, delete, truncate on public.platform_settings, public.workspaces,
  public.workspace_members, public.workspace_domains, public.invitations, public.audit_log,
  public.public_email_domains
  from authenticated;

-------------------------------------------------------------------------------
-- Membership helpers. Every RLS policy and permission check builds on these.
-------------------------------------------------------------------------------

-- Verified email of the current user, lower-cased; null if unverified.
create function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

-- Active member of the workspace right now. Members who joined through a domain
-- lose access as soon as that domain is disabled or removed from the workspace.
create function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.current_email() is not null
      and (
        m.joined_via <> 'domain'
        or exists (
          select 1 from public.workspace_domains d
          where d.workspace_id = ws
            and d.is_active
            and d.domain = public.email_domain(public.current_email())
        )
      )
  );
$$;

-- 'owner' | 'admin' | 'member' for an active member, otherwise null.
create function public.workspace_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = ws and m.user_id = auth.uid() and public.is_workspace_member(ws);
$$;

create function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.workspace_role(ws) in ('owner', 'admin'), false);
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_email() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin);
$$;

-- True when the user may use the app at all: a member of some workspace, or
-- open registration lets them in to create their own.
create function public.has_platform_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_email() is not null and (
    exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    )
    or (select open_registration from public.platform_settings)
  );
$$;

-- Two people can see each other's profile only when they share a workspace.
create function public.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (other = auth.uid() and public.current_email() is not null)
      or exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs
          on theirs.workspace_id = mine.workspace_id
         and theirs.user_id = other
         and theirs.status = 'active'
        where mine.user_id = auth.uid() and public.is_workspace_member(mine.workspace_id)
      );
$$;

create function public.log_workspace_action(ws uuid, action text, details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (ws, auth.uid(), action, coalesce(details, '{}'::jsonb));
$$;

-- Legacy check used by the pre-workspace app; now means "may use the app".
-- Dropped in 20261028130000_drop_legacy.sql.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_platform_access();
$$;

-------------------------------------------------------------------------------
-- Move existing data into the first workspace "iyo"
-------------------------------------------------------------------------------

do $$
declare
  first_owner uuid;
  ws uuid;
begin
  -- Fresh installations have no users yet: the first person creates a workspace.
  if not exists (select 1 from public.profiles) then
    return;
  end if;

  select coalesce(
    (select id from public.profiles where email = 'elaidzha_motion.designer@iyo.gg'),
    (select id from public.profiles where is_admin order by created_at limit 1),
    (select id from public.profiles order by created_at limit 1)
  ) into first_owner;

  insert into public.workspaces (name, owner_id, created_by)
  values ('iyo', first_owner, first_owner)
  returning id into ws;

  update public.profiles set is_platform_admin = true where id = first_owner;

  insert into public.workspace_domains (domain, workspace_id, is_active, verified, added_by, added_at)
  select domain, ws, is_active, true, added_by, added_at from public.allowed_domains;

  insert into public.workspace_members (workspace_id, user_id, role, joined_via, joined_at)
  select
    ws,
    p.id,
    case when p.id = first_owner then 'owner' when p.is_admin then 'admin' else 'member' end,
    -- The owner keeps access whatever happens to the domains.
    case
      when p.id = first_owner then 'creator'
      when exists (select 1 from public.allowed_domains d where d.domain = public.email_domain(p.email))
        then 'domain'
      else 'invite'
    end,
    p.created_at
  from public.profiles p;

  insert into public.audit_log (workspace_id, actor_id, action, details, created_at)
  select ws, actor_id, action, details, created_at
  from public.admin_audit_log
  order by id;
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.generate_short_id(),
  public.current_email(),
  public.is_workspace_member(uuid),
  public.workspace_role(uuid),
  public.is_workspace_admin(uuid),
  public.is_platform_admin(),
  public.has_platform_access(),
  public.shares_workspace_with(uuid),
  public.log_workspace_action(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.is_workspace_member(uuid),
  public.shares_workspace_with(uuid),
  public.workspace_role(uuid),
  public.is_workspace_admin(uuid),
  public.is_platform_admin(),
  public.has_platform_access()
to authenticated;

-------------------------------------------------------------------------------
-- RLS
-------------------------------------------------------------------------------

create policy "Members can read their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy "Members can read the member list"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Admins can read workspace domains"
  on public.workspace_domains for select to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy "Admins can read invitations"
  on public.invitations for select to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy "Admins read their log; platform admins read platform events"
  on public.audit_log for select to authenticated
  using (
    (workspace_id is not null and public.is_workspace_admin(workspace_id))
    or (workspace_id is null and public.is_platform_admin())
  );

create policy "Anyone signed in can read platform settings"
  on public.platform_settings for select to authenticated
  using (true);

-- Profiles: yourself and people who share a workspace with you.
drop policy "Allowed users can read profiles" on public.profiles;
create policy "Users can read profiles of people in their workspaces"
  on public.profiles for select to authenticated
  using (public.shares_workspace_with(id));
