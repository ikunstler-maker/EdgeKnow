-- Undo 20261218100000_task_field_hints (the function keeps working: hint is just ignored once gone).
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
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if char_length(btrim(coalesce(definition ->> 'name', ''))) not between 1 and 60 then
    return public.page_error('invalid_name');
  end if;
  if field_id is null and not (new_kind = any (kinds)) then
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
    insert into public.task_fields (project_id, workspace_id, name, kind, options, required, task_types, position)
    values (target_project, ws, btrim(definition ->> 'name'), new_kind, new_options, coalesce((definition ->> 'required')::boolean, false), types,
            coalesce((select max(f.position) from public.task_fields f where f.project_id = target_project), 0) + 1)
    returning id into saved;
  else
    -- The kind stays: the values already given are of that kind.
    update public.task_fields set
      name = btrim(definition ->> 'name'),
      options = new_options,
      required = coalesce((definition ->> 'required')::boolean, required),
      task_types = case when definition ? 'task_types' then types else task_types end,
      position = coalesce((definition ->> 'position')::double precision, position)
    where id = field_id and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

alter table public.task_fields drop column if exists hint;
