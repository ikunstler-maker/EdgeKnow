-- Objects of the services (node space, step Н1): mind maps and diagrams now;
-- boards, sheets, slides and surveys later use the same table. Access works like
-- for pages: the owner, the workspace's owner and admins, the whole workspace,
-- people and groups; checked by RLS here and in every function.
-- The same in supabase/team/migrations/0013_service_objects.sql.
-- Rollback: supabase/rollbacks/20261127100000_service_objects.down.sql

-------------------------------------------------------------------------------
-- Objects of the services (node space first; boards, sheets, slides, surveys later)
-------------------------------------------------------------------------------

create table public.service_objects (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  service         text not null check (service in ('nodes', 'boards', 'sheets', 'slides', 'surveys')),
  -- nodes: 'mindmap' or 'flow'
  kind            text not null check (char_length(kind) between 1 and 20),
  title           text not null default '' check (char_length(title) <= 200),
  icon            text check (char_length(icon) <= 16),
  data            jsonb not null default '{}'::jsonb,
  -- Plain text of the object, for search.
  search_text     text not null default '',
  version         integer not null default 1,
  owner_id        uuid references public.profiles (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  -- What everyone in the workspace may do (null: only people and groups given access).
  workspace_role  text default 'editor' check (workspace_role in ('editor', 'commenter', 'viewer')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null
);
create index service_objects_ws_idx on public.service_objects (workspace_id, service, updated_at desc) where deleted_at is null;

create table public.service_object_access (
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (object_id, user_id)
);

create table public.service_object_group_access (
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (object_id, group_id)
);

create function public.check_service_object_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.object_id) then
    raise exception 'access and object must be in the same workspace';
  end if;
  if tg_table_name = 'service_object_group_access' then
    if new.workspace_id is distinct from (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) then
      raise exception 'group and object must be in the same workspace';
    end if;
  end if;
  return new;
end;
$$;
create trigger service_object_access_same_workspace before insert or update on public.service_object_access
  for each row execute function public.check_service_object_workspace();
create trigger service_object_group_access_same_workspace before insert or update on public.service_object_group_access
  for each row execute function public.check_service_object_workspace();

-- 'owner' (its owner, the workspace owner and admins, or given), 'editor', 'commenter', 'viewer' or null.
create function public.service_object_role_of(target_object uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with object as (select * from public.service_objects o where o.id = target_object),
  candidates as (
    select 'owner' as role from object o where o.owner_id = member and public.is_active_member(o.workspace_id, member)
    union all
    select 'owner' from object o
    join public.workspace_members m on m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select o.workspace_role from object o where o.workspace_role is not null and public.is_active_member(o.workspace_id, member)
    union all
    select a.role from public.service_object_access a where a.object_id = target_object and a.user_id = member
    union all
    select ga.role from public.service_object_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    where ga.object_id = target_object
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

-- The signed-in person's role, checking workspace membership first.
create function public.service_object_role(target_object uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.service_object_role_of(o.id, auth.uid())
  from public.service_objects o
  where o.id = target_object and public.is_workspace_member(o.workspace_id);
$$;

alter table public.service_objects enable row level security;
alter table public.service_object_access enable row level security;
alter table public.service_object_group_access enable row level security;
revoke all on public.service_objects, public.service_object_access, public.service_object_group_access from public, anon, authenticated;
grant select on public.service_objects, public.service_object_access, public.service_object_group_access to authenticated;

create policy "Members see the objects open to them"
  on public.service_objects for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(id) is not null);
create policy "Members see who has access to objects open to them"
  on public.service_object_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null);
create policy "Members see group access of objects open to them"
  on public.service_object_group_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null);

-- The text of the nodes, for search.
create function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from jsonb_path_query(coalesce(content, '{}'::jsonb), 'strict $.nodes[*].text') value;
$$;

-- A new object; anyone in the workspace (like a page).
create function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;
  if target_service not in ('nodes') or (target_service = 'nodes' and new_kind not in ('mindmap', 'flow')) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;
  if pg_column_size(coalesce(new_data, '{}'::jsonb)) > 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.service_objects o where o.workspace_id = ws and o.deleted_at is null) >= 5000 then
    return public.page_error('too_many');
  end if;
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), auth.uid(), auth.uid(), auth.uid())
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

-- Save title and content; base_version must match (someone else may have saved meanwhile).
create function public.save_service_object(target_object uuid, new_title text, new_data jsonb, base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, object.title)) > 200 then
    return public.page_error('title_too_long');
  end if;
  if new_data is not null and pg_column_size(new_data) > 1048576 then
    return public.page_error('too_large');
  end if;
  if base_version is distinct from object.version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', object.version);
  end if;
  update public.service_objects set
    title = coalesce(btrim(new_title), title),
    data = coalesce(new_data, data),
    search_text = case when new_data is not null then public.service_object_text(new_data) else search_text end,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_object;
  return jsonb_build_object('ok', true, 'version', object.version + 1);
end;
$$;

-- To the bin and back (editors); forever only those who manage it, from the bin.
create function public.trash_service_object(target_object uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.service_objects
  set deleted_at = case when restore then null else now() end,
      deleted_by = case when restore then null else auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
  where id = target_object;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.delete_service_object_forever(target_object uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.service_object_role(target_object), '') <> 'owner'
     or not exists (select 1 from public.service_objects o where o.id = target_object and o.deleted_at is not null) then
    return public.page_error('forbidden');
  end if;
  delete from public.service_objects where id = target_object;
  return jsonb_build_object('ok', true);
end;
$$;

-- Who may do what: those who manage the object (role 'owner').
create function public.set_service_object_workspace_role(target_object uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.service_object_role(target_object), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.service_objects set workspace_role = new_role where id = target_object;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_service_object_member_role(target_object uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object);
begin
  if coalesce(public.service_object_role(target_object), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if new_role is null then
    delete from public.service_object_access where object_id = target_object and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not public.is_active_member(ws, member) then
    return public.page_error('not_a_member');
  end if;
  insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
  values (target_object, ws, member, new_role, auth.uid())
  on conflict (object_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_service_object_group_role(target_object uuid, target_group uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object);
begin
  if coalesce(public.service_object_role(target_object), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if new_role is null then
    delete from public.service_object_group_access where object_id = target_object and group_id = target_group;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = target_group and g.workspace_id = ws) then
    return public.page_error('invalid');
  end if;
  insert into public.service_object_group_access (object_id, workspace_id, group_id, role, granted_by)
  values (target_object, ws, target_group, new_role, auth.uid())
  on conflict (object_id, group_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

-- Someone who leaves loses what was given to them personally.
create function public.drop_object_access_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.service_object_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger workspace_members_drop_object_access after update of status on public.workspace_members
  for each row execute function public.drop_object_access_of_removed_member();

revoke execute on function
  public.service_object_role_of(uuid, uuid),
  public.check_service_object_workspace(),
  public.drop_object_access_of_removed_member()
from public, anon, authenticated;
revoke execute on function
  public.service_object_role(uuid),
  public.service_object_text(jsonb),
  public.create_service_object(uuid, text, text, text, jsonb),
  public.save_service_object(uuid, text, jsonb, integer),
  public.trash_service_object(uuid, boolean),
  public.delete_service_object_forever(uuid),
  public.set_service_object_workspace_role(uuid, text),
  public.set_service_object_member_role(uuid, uuid, text),
  public.set_service_object_group_role(uuid, uuid, text)
from public, anon;
grant execute on function
  public.service_object_role(uuid),
  public.create_service_object(uuid, text, text, text, jsonb),
  public.save_service_object(uuid, text, jsonb, integer),
  public.trash_service_object(uuid, boolean),
  public.delete_service_object_forever(uuid),
  public.set_service_object_workspace_role(uuid, text),
  public.set_service_object_member_role(uuid, uuid, text),
  public.set_service_object_group_role(uuid, uuid, text)
to authenticated;

-- Moving a workspace into its team database also brings the people of its objects.
CREATE OR REPLACE FUNCTION public.team_move_people(ws uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ids as (
    select owner_id as id from public.pages where workspace_id = ws
    union select created_by from public.pages where workspace_id = ws
    union select updated_by from public.pages where workspace_id = ws
    union select deleted_by from public.pages where workspace_id = ws
    union select user_id from public.page_access where workspace_id = ws
    union select granted_by from public.page_access where workspace_id = ws
    union select created_by from public.comment_threads where workspace_id = ws
    union select resolved_by from public.comment_threads where workspace_id = ws
    union select author_id from public.comments where workspace_id = ws
    union select uploaded_by from public.attachments where workspace_id = ws
    union select user_id from public.page_mentions where workspace_id = ws
    union select mentioned_by from public.page_mentions where workspace_id = ws
    union select user_id from public.page_contributions where workspace_id = ws
    union select actor_id from public.audit_log where workspace_id = ws
    union select user_id from public.workspace_members where workspace_id = ws
    union select owner_id from public.workspaces where id = ws
    union select reporter_id from public.tasks where workspace_id = ws
    union select assignee_id from public.tasks where workspace_id = ws
    union select updated_by from public.tasks where workspace_id = ws
    union select deleted_by from public.tasks where workspace_id = ws
    union select author_id from public.task_comments where workspace_id = ws
    union select actor_id from public.task_events where workspace_id = ws
    union select user_id from public.task_project_access where workspace_id = ws
    union select created_by from public.task_projects where workspace_id = ws
    union select owner_id from public.service_objects where workspace_id = ws
    union select created_by from public.service_objects where workspace_id = ws
    union select updated_by from public.service_objects where workspace_id = ws
    union select deleted_by from public.service_objects where workspace_id = ws
    union select user_id from public.service_object_access where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
