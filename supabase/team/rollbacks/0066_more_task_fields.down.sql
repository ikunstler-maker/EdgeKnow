-- Undo 0066_more_task_fields.
create or replace function public.save_task_field(target_project uuid, field_id uuid, definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  kinds text[] := array['text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person'];
  new_kind text := definition ->> 'kind';
  new_options jsonb := coalesce(definition -> 'options', '[]'::jsonb);
  types text[];
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner'
     and not (public.task_project_role(target_project) is not null
              and public.role_allows((select p.workspace_id from public.task_projects p where p.id = target_project), 'manage_fields')) then
    return public.page_error('forbidden');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if char_length(btrim(coalesce(definition ->> 'name', ''))) not between 1 and 60 then
    return public.page_error('invalid_name');
  end if;
  if field_id is null and not (new_kind = any (kinds)) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(definition ->> 'hint', '')) > 300 then
    return public.page_error('invalid');
  end if;
  if jsonb_typeof(new_options) <> 'array' or jsonb_array_length(new_options) > 100 or exists (
    select 1 from jsonb_array_elements(new_options) o
    where coalesce(o ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,40}$'
       or char_length(btrim(coalesce(o ->> 'label', ''))) not between 1 and 60
       or (o ? 'color' and o ->> 'color' is not null and (o ->> 'color') !~* '^#[0-9a-f]{6}$')
  ) or (select count(distinct o ->> 'id') from jsonb_array_elements(new_options) o) <> jsonb_array_length(new_options) then
    return public.page_error('invalid_options');
  end if;
  if definition ? 'task_types' and jsonb_typeof(definition -> 'task_types') = 'array' then
    types := array(select jsonb_array_elements_text(definition -> 'task_types'));
    if not types <@ array['task', 'bug', 'idea', 'epic'] then
      return public.page_error('invalid');
    end if;
    if cardinality(types) = 0 then
      types := null;
    end if;
  end if;
  if field_id is null then
    if (select count(*) from public.task_fields f where f.project_id = target_project) >= 50 then
      return public.page_error('too_many_fields');
    end if;
    insert into public.task_fields (project_id, workspace_id, name, kind, options, required, task_types, position, hint)
    values (target_project, ws, btrim(definition ->> 'name'), new_kind, new_options, coalesce((definition ->> 'required')::boolean, false), types,
            coalesce((select max(f.position) from public.task_fields f where f.project_id = target_project), 0) + 1,
            nullif(btrim(coalesce(definition ->> 'hint', '')), ''))
    returning id into saved;
  else
    -- The kind stays: the values already given are of that kind.
    update public.task_fields set
      name = btrim(definition ->> 'name'),
      options = new_options,
      required = coalesce((definition ->> 'required')::boolean, required),
      task_types = case when definition ? 'task_types' then types else task_types end,
      position = coalesce((definition ->> 'position')::double precision, position),
      hint = case when definition ? 'hint' then nullif(btrim(coalesce(definition ->> 'hint', '')), '') else hint end
    where id = field_id and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

create or replace function public.task_custom_valid(project uuid, custom jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = project);
  entry record;
  field public.task_fields;
  ids text[];
begin
  if custom is null then
    return null;
  end if;
  if jsonb_typeof(custom) <> 'object' then
    return 'invalid_field';
  end if;
  for entry in select key, value from jsonb_each(custom) loop
    select * into field from public.task_fields f where f.id::text = entry.key and f.project_id = project;
    if not found then
      return 'invalid_field';
    end if;
    continue when jsonb_typeof(entry.value) = 'null';
    ids := array(select o ->> 'id' from jsonb_array_elements(field.options) o);
    if field.kind in ('text', 'url') and (jsonb_typeof(entry.value) <> 'string' or char_length(entry.value #>> '{}') > 500) then
      return 'invalid_value';
    elsif field.kind = 'url' and (entry.value #>> '{}') !~* '^https?://[^\s]+$' then
      return 'invalid_value';
    elsif field.kind = 'longtext' and (jsonb_typeof(entry.value) <> 'string' or char_length(entry.value #>> '{}') > 10000) then
      return 'invalid_value';
    elsif field.kind = 'number' and jsonb_typeof(entry.value) <> 'number' then
      return 'invalid_value';
    elsif field.kind in ('checkbox', 'toggle') and jsonb_typeof(entry.value) <> 'boolean' then
      return 'invalid_value';
    elsif field.kind = 'date' and (jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      return 'invalid_value';
    elsif field.kind = 'color' and (jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~* '^#[0-9a-f]{6}$') then
      return 'invalid_value';
    elsif field.kind = 'select' and (jsonb_typeof(entry.value) <> 'string' or not ((entry.value #>> '{}') = any (ids))) then
      return 'invalid_value';
    elsif field.kind = 'multiselect' and (jsonb_typeof(entry.value) <> 'array'
          or exists (select 1 from jsonb_array_elements(entry.value) v where jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (ids)))) then
      return 'invalid_value';
    elsif field.kind = 'person' and (jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~ '^[0-9a-f-]{36}$'
          or not public.is_active_member(ws, (entry.value #>> '{}')::uuid)) then
      return 'invalid_value';
    end if;
  end loop;
  return null;
end;
$$;
drop function public.copy_task_field(uuid, text);
-- Fields of the newer kinds go, with their values in tasks; values written by hand in lists go too.
update public.tasks t set custom = t.custom - (select coalesce(array_agg(f.id::text), '{}') from public.task_fields f
  where f.project_id = t.project_id and f.kind in ('duration', 'heading', 'divider', 'language', 'geo', 'currency'))
where exists (select 1 from public.task_fields f where f.project_id = t.project_id and f.kind in ('duration', 'heading', 'divider', 'language', 'geo', 'currency'));
delete from public.task_fields where kind in ('duration', 'heading', 'divider', 'language', 'geo', 'currency');
alter table public.task_fields drop column width;
alter table public.task_fields drop constraint task_fields_kind_check;
alter table public.task_fields add constraint task_fields_kind_check check (kind in ('text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person'));
