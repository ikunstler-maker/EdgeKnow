-- Boards, step Д1: the service "boards" (kind "board", an Excalidraw scene) in the
-- shared objects table; access, versions and the bin as for maps.
-- The same in supabase/team/migrations/0017_boards.sql.
-- Rollback: supabase/rollbacks/20261130100000_boards.down.sql

-- Boards may be created (guests still create nothing).
create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;

  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind = 'board')) then
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


-- What search reads from an object: also the texts and frame names of a board.
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
  ) parts
  where jsonb_typeof(value) = 'string' and value #>> '{}' <> '';
$$;
revoke execute on function public.service_object_text(jsonb) from public, anon;

-- Boards saved before have their text now (none yet; kept for safety).
update public.service_objects set search_text = public.service_object_text(data) where service = 'boards';
