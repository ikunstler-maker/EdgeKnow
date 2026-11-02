-- Tasks: a project's own fields (text, number, lists with their items and
-- colours, checkbox, toggle, date, colour, link, person), per task type.
-- The same in supabase/team/migrations/0007_task_fields.sql.
-- Rollback: supabase/rollbacks/20261121100000_task_fields.down.sql

-- A project's own fields: the project owner decides which fields tasks have, of
-- which kind, and for which task types (that is each type's template).
create table public.task_fields (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  kind          text not null check (kind in ('text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'toggle', 'date', 'color', 'url', 'person')),
  -- For lists: [{"id": "a1", "label": "Висока", "color": "#ff8800"}, …]
  options       jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  -- Shown as "to fill in" until it has a value (never blocks saving).
  required      boolean not null default false,
  -- Which task types have it; null: all.
  task_types    text[] check (task_types <@ array['task', 'bug', 'idea', 'epic']),
  position      double precision not null default 0,
  created_at    timestamptz not null default now()
);
create index task_fields_project_idx on public.task_fields (project_id, position);
create trigger task_fields_same_workspace before insert or update on public.task_fields
  for each row execute function public.check_task_workspace();

alter table public.task_fields enable row level security;
revoke all on public.task_fields from public, anon, authenticated;
grant select on public.task_fields to authenticated;
create policy "Members see the fields of projects open to them"
  on public.task_fields for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);

-- The values: {"<field id>": value, …}, checked against each field's kind.
alter table public.tasks add column custom jsonb not null default '{}' check (jsonb_typeof(custom) = 'object');

-- null when every value fits its field (null values mean "clear").
create function public.task_custom_valid(project uuid, custom jsonb)
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

-- Add or change a field (no id: a new one). Project owners only.
create function public.save_task_field(target_project uuid, field_id uuid, definition jsonb)
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

-- Removing a field also clears its values from the tasks.
create function public.delete_task_field(target_field uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field public.task_fields;
begin
  select * into field from public.task_fields where id = target_field;
  if not found or coalesce(public.task_project_role(field.project_id), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  delete from public.task_fields where id = target_field;
  update public.tasks set custom = custom - target_field::text where project_id = field.project_id and custom ? target_field::text;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.task_custom_valid(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_task_field(uuid, uuid, jsonb), public.delete_task_field(uuid) from public, anon;
grant execute on function public.save_task_field(uuid, uuid, jsonb), public.delete_task_field(uuid) to authenticated;

create or replace function public.create_task(target_project uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  problem text;
  status uuid;
  new_id uuid;
  new_number integer;
begin
  if public.role_rank(public.task_project_role(target_project)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  problem := public.task_fields_valid(target_project, fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  problem := public.task_custom_valid(target_project, fields -> 'custom');
  if problem is not null then
    return public.page_error(problem);
  end if;
  update public.task_projects set next_number = next_number + 1
  where id = target_project and archived_at is null
  returning * into project;
  if not found then
    return public.page_error('archived');
  end if;
  new_number := project.next_number - 1;
  status := coalesce((fields ->> 'status_id')::uuid,
    (select s.id from public.task_statuses s where s.project_id = target_project order by
       case s.category when 'todo' then 0 when 'doing' then 1 else 2 end, s.position limit 1));
  insert into public.tasks (workspace_id, project_id, number, title, description, status_id, type, priority,
                            assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, updated_by, custom)
  values (
    project.workspace_id, target_project, new_number, btrim(fields ->> 'title'), fields -> 'description', status,
    coalesce(fields ->> 'type', 'task'), coalesce(fields ->> 'priority', 'medium'),
    (fields ->> 'assignee_id')::uuid, auth.uid(),
    coalesce((select array_agg(l) from jsonb_array_elements_text(fields -> 'labels') l), '{}'),
    (fields ->> 'start_date')::date, (fields ->> 'due_date')::date, (fields ->> 'estimate')::numeric,
    (fields ->> 'parent_id')::uuid,
    coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1,
    auth.uid(),
    jsonb_strip_nulls(coalesce(fields -> 'custom', '{}'::jsonb))
  )
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'key', project.key || '-' || new_number, 'number', new_number);
end;
$$;

create or replace function public.update_task(target_task uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  problem text;
  new_status uuid;
  done boolean;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  problem := public.task_fields_valid(task.project_id, changes);
  if problem is not null then
    return public.page_error(problem);
  end if;
  problem := public.task_custom_valid(task.project_id, changes -> 'custom');
  if problem is not null then
    return public.page_error(problem);
  end if;
  if (changes ->> 'parent_id')::uuid = target_task then
    return public.page_error('invalid_parent');
  end if;
  new_status := case when changes ? 'status_id' then (changes ->> 'status_id')::uuid else task.status_id end;
  done := (select s.category = 'done' from public.task_statuses s where s.id = new_status);
  update public.tasks set
    title = case when changes ? 'title' then btrim(changes ->> 'title') else title end,
    description = case when changes ? 'description' then changes -> 'description' else description end,
    status_id = new_status,
    type = coalesce(changes ->> 'type', type),
    priority = coalesce(changes ->> 'priority', priority),
    assignee_id = case when changes ? 'assignee_id' then (changes ->> 'assignee_id')::uuid else assignee_id end,
    labels = case when changes ? 'labels' then coalesce((select array_agg(l) from jsonb_array_elements_text(changes -> 'labels') l), '{}') else labels end,
    start_date = case when changes ? 'start_date' then (changes ->> 'start_date')::date else start_date end,
    due_date = case when changes ? 'due_date' then (changes ->> 'due_date')::date else due_date end,
    estimate = case when changes ? 'estimate' then (changes ->> 'estimate')::numeric else estimate end,
    parent_id = case when changes ? 'parent_id' then (changes ->> 'parent_id')::uuid else parent_id end,
    position = coalesce((changes ->> 'position')::double precision, position),
    -- Own fields merge: a value replaces, null clears.
    custom = case when changes ? 'custom' then jsonb_strip_nulls(custom || (changes -> 'custom')) else custom end,
    done_at = case when done and done_at is null then now() when not done then null else done_at end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_task;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.record_task_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field text;
  before jsonb;
  after jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (workspace_id, task_id, actor_id, field, new_value)
    values (new.workspace_id, new.id, auth.uid(), 'created', to_jsonb(new.title));
    return new;
  end if;
  before := to_jsonb(old);
  after := to_jsonb(new);
  foreach field in array array['title', 'status_id', 'type', 'priority', 'assignee_id', 'labels', 'start_date', 'due_date', 'estimate', 'parent_id', 'deleted_at', 'custom'] loop
    if before -> field is distinct from after -> field then
      insert into public.task_events (workspace_id, task_id, actor_id, field, old_value, new_value)
      values (new.workspace_id, new.id, auth.uid(), field, before -> field, after -> field);
    end if;
  end loop;
  if old.description is distinct from new.description then
    insert into public.task_events (workspace_id, task_id, actor_id, field)
    values (new.workspace_id, new.id, auth.uid(), 'description');
  end if;
  return new;
end;
$$;
