-- Undo 20270106100000_apps. Company apps go away with it (the old check would refuse them).

create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- Custom roles (company structure, stage 2) may take this right away; guests keep their own rules.
  if not guest and not public.role_allows(ws, 'create_objects') then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;
  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind in ('board', 'design'))
          or (target_service = 'sheets' and new_kind = 'sheet') or (target_service = 'surveys' and new_kind = 'survey')
          or (target_service = 'slides' and new_kind = 'deck')) then
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
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by, workspace_role)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(), auth.uid(),
          case when target_service = 'surveys' then 'viewer' else 'editor' end)
  returning id into new_id;
  -- A guest's map or board belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
    values (new_id, ws, auth.uid(), 'editor', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

create or replace function public.service_object_role_of(target_object uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with object as (select * from public.service_objects o where o.id = target_object),
  guest as (select public.is_guest((select o.workspace_id from object o), member) as yes),
  candidates as (
    select 'owner' as role from object o where o.owner_id = member and public.is_active_member(o.workspace_id, member)
    union all
    select 'owner' from object o
    join public.workspace_members m on m.workspace_id = o.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select public.capped_role(o.workspace_id, member, o.workspace_role) from object o, guest g
    where o.workspace_role is not null and not g.yes and public.is_active_member(o.workspace_id, member)
    union all
    select case when g.yes and a.role = 'owner' then 'editor' else a.role end
    from public.service_object_access a, guest g where a.object_id = target_object and a.user_id = member
    union all
    select ga.role from public.service_object_group_access ga
    -- Company structure, stage 3: a unit's grant reaches its sub-units and the leads above it.
    join lateral (select 1 where public.unit_reaches(ga.group_id, member)) gm on true
    cross join guest g
    where ga.object_id = target_object and not g.yes
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

create or replace function public.register_object_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or object.service not in ('boards', 'slides')
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object) >= 500 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images and task files count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = object.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = object.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = object.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;

create or replace function public.save_service_object(target_object uuid, new_title text, new_data jsonb, base_version integer)
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

create or replace function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from (
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.slides[*].nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.pages[*].nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.edges[*].label') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].celldata[*].v.m') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].options[*].label') value
  ) parts
  where jsonb_typeof(value) = 'string' and value #>> '{}' <> '';
$$;

delete from public.service_objects where service = 'apps';
alter table public.service_objects drop constraint service_objects_service_check;
alter table public.service_objects add constraint service_objects_service_check
  check (service in ('nodes', 'boards', 'sheets', 'slides', 'surveys'));
drop function public.app_data_ok(jsonb);
