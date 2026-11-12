-- Rukh: more kinds of own fields (duration, heading, divider, languages, geos, currencies),
-- a field's width, copying a field, and one's own value in lists.
-- The same in supabase/team/migrations/0066_more_task_fields.sql.
-- Rollback: supabase/rollbacks/20270121100000_more_task_fields.down.sql

-- More kinds of a project's own fields: a duration (kept in seconds), a heading and a
-- divider (they only shape the card and hold no value), and languages, geos and currencies
-- (several codes from a list the site keeps, or one's own). A field is as wide as the
-- card or half of it. In every list a person may also write something of their own
-- (kept as "other:<text>").
alter table public.task_fields drop constraint task_fields_kind_check;
alter table public.task_fields add constraint task_fields_kind_check check (kind in ('text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person', 'duration', 'heading', 'divider', 'language', 'geo', 'currency'));
alter table public.task_fields add column width text not null default 'full' check (width in ('full', 'half'));

create or replace function public.save_task_field(target_project uuid, field_id uuid, definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  kinds text[] := array['text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person', 'duration', 'heading', 'divider', 'language', 'geo', 'currency'];
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
  if char_length(coalesce(definition ->> 'hint', '')) > 300 or coalesce(definition ->> 'width', 'full') not in ('full', 'half') then
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
    insert into public.task_fields (project_id, workspace_id, name, kind, options, required, task_types, position, hint, width)
    values (target_project, ws, btrim(definition ->> 'name'), new_kind, new_options, coalesce((definition ->> 'required')::boolean, false), types,
            coalesce((select max(f.position) from public.task_fields f where f.project_id = target_project), 0) + 1,
            nullif(btrim(coalesce(definition ->> 'hint', '')), ''), coalesce(definition ->> 'width', 'full'))
    returning id into saved;
  else
    -- The kind stays: the values already given are of that kind.
    update public.task_fields set
      name = btrim(definition ->> 'name'),
      options = new_options,
      required = coalesce((definition ->> 'required')::boolean, required),
      task_types = case when definition ? 'task_types' then types else task_types end,
      position = coalesce((definition ->> 'position')::double precision, position),
      hint = case when definition ? 'hint' then nullif(btrim(coalesce(definition ->> 'hint', '')), '') else hint end,
      width = coalesce(definition ->> 'width', width)
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
    elsif field.kind in ('heading', 'divider') then
      return 'invalid_value';
    elsif field.kind = 'duration' and (jsonb_typeof(entry.value) <> 'number' or (entry.value #>> '{}') !~ '^[0-9]{1,9}$') then
      return 'invalid_value';
    elsif field.kind in ('language', 'geo', 'currency') and (jsonb_typeof(entry.value) <> 'array' or jsonb_array_length(entry.value) > 100
          or exists (select 1 from jsonb_array_elements(entry.value) v where jsonb_typeof(v) <> 'string'
                     or not ((v #>> '{}') ~ '^[A-Za-z]{2,3}$' or (v #>> '{}') ~ '^other:.{1,60}$'))) then
      return 'invalid_value';
    elsif field.kind = 'select' and (jsonb_typeof(entry.value) <> 'string' or not ((entry.value #>> '{}') = any (ids) or (entry.value #>> '{}') ~ '^other:.{1,100}$')) then
      return 'invalid_value';
    elsif field.kind = 'multiselect' and (jsonb_typeof(entry.value) <> 'array'
          or jsonb_array_length(entry.value) > 100
          or exists (select 1 from jsonb_array_elements(entry.value) v where jsonb_typeof(v) <> 'string'
                     or not ((v #>> '{}') = any (ids) or (v #>> '{}') ~ '^other:.{1,100}$'))) then
      return 'invalid_value';
    elsif field.kind = 'person' and (jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~ '^[0-9a-f-]{36}$'
          or not public.is_active_member(ws, (entry.value #>> '{}')::uuid)) then
      return 'invalid_value';
    end if;
  end loop;
  return null;
end;
$$;

-- A copy of a field, placed right after it: the same kind, options, width and hint.
-- Whoever may manage the project's fields.
create function public.copy_task_field(target_field uuid, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field public.task_fields;
  after double precision;
  saved uuid;
begin
  select * into field from public.task_fields where id = target_field;
  if field.id is null
     or (coalesce(public.task_project_role(field.project_id), '') <> 'owner'
         and not (public.task_project_role(field.project_id) is not null and public.role_allows(field.workspace_id, 'manage_fields'))) then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 60 then
    return public.page_error('invalid_name');
  end if;
  if (select count(*) from public.task_fields f where f.project_id = field.project_id) >= 50 then
    return public.page_error('too_many_fields');
  end if;
  after := (select min(f.position) from public.task_fields f where f.project_id = field.project_id and f.position > field.position);
  insert into public.task_fields (project_id, workspace_id, name, kind, options, required, task_types, position, hint, width)
  values (field.project_id, field.workspace_id, btrim(new_name), field.kind, field.options, false, field.task_types,
          case when after is null then field.position + 1 else (field.position + after) / 2 end, field.hint, field.width)
  returning id into saved;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;
revoke execute on function public.copy_task_field(uuid, text) from public, anon;
grant execute on function public.copy_task_field(uuid, text) to authenticated;
