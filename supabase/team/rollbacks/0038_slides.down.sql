-- Undo 0038_slides.
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

  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind = 'board')
          or (target_service = 'sheets' and new_kind = 'sheet') or (target_service = 'surveys' and new_kind = 'survey')) then
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
  if not found or object.deleted_at is not null or object.service <> 'boards'
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
  -- A team's own storage: its project's plan sets the limit.
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
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
