-- Undo 20270110100000_import_people (seats are forgotten; tasks keep whoever they were given to).
create or replace function public.import_tasks(target_project uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  item jsonb;
  existing uuid;
  new_id uuid;
  category text;
  made integer := 0;
  updated integer := 0;
  top integer := 0;
begin
  select * into project from public.task_projects where id = target_project for update;
  if project.id is null then
    return public.page_error('not_found');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    return public.page_error('invalid');
  end if;
  perform set_config('ek.importing', 'on', true);
  perform set_config('ek.by_rule', 'on', true);
  for item in select * from jsonb_array_elements(items) loop
    if coalesce(item ->> 'external_key', '') = '' or (item ->> 'number') is null or (item ->> 'number')::integer < 1 then
      return public.page_error('invalid');
    end if;
    select s.category into category from public.task_statuses s where s.id = (item ->> 'status_id')::uuid and s.project_id = target_project;
    if category is null then
      return public.page_error('invalid_status');
    end if;
    top := greatest(top, (item ->> 'number')::integer);
    select t.id into existing from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
    if existing is not null then
      update public.tasks set
        title = left(btrim(item ->> 'title'), 300),
        description = item -> 'description',
        status_id = (item ->> 'status_id')::uuid,
        type = coalesce(item ->> 'type', 'task'),
        priority = coalesce(item ->> 'priority', 'medium'),
        assignee_id = (item ->> 'assignee_id')::uuid,
        reporter_id = (item ->> 'reporter_id')::uuid,
        imported_assignee = left(item ->> 'imported_assignee', 120),
        imported_reporter = left(item ->> 'imported_reporter', 120),
        labels = coalesce((select array_agg(l) from jsonb_array_elements_text(item -> 'labels') l), '{}'),
        start_date = (item ->> 'start_date')::date,
        due_date = (item ->> 'due_date')::date,
        estimate = (item ->> 'estimate')::numeric,
        external_url = item ->> 'external_url',
        updated_at = coalesce((item ->> 'updated_at')::timestamptz, now()),
        done_at = case when category = 'done' then coalesce((item ->> 'done_at')::timestamptz, done_at, (item ->> 'updated_at')::timestamptz, now()) end,
        custom = custom || jsonb_strip_nulls(coalesce(item -> 'custom', '{}'::jsonb))
      where id = existing;
      updated := updated + 1;
    else
      -- The number is the old tracker's; a task of our own may not stand on it.
      if exists (select 1 from public.tasks t where t.project_id = target_project and t.number = (item ->> 'number')::integer) then
        return jsonb_build_object('ok', false, 'error', 'number_taken', 'number', (item ->> 'number')::integer);
      end if;
      insert into public.tasks (workspace_id, project_id, number, title, description, status_id, type, priority, assignee_id, reporter_id,
                                imported_assignee, imported_reporter, labels, start_date, due_date, estimate, position, created_at, updated_at,
                                done_at, custom, external_key, external_url)
      values (
        project.workspace_id, target_project, (item ->> 'number')::integer, left(btrim(item ->> 'title'), 300), item -> 'description',
        (item ->> 'status_id')::uuid, coalesce(item ->> 'type', 'task'), coalesce(item ->> 'priority', 'medium'),
        (item ->> 'assignee_id')::uuid, (item ->> 'reporter_id')::uuid,
        left(item ->> 'imported_assignee', 120), left(item ->> 'imported_reporter', 120),
        coalesce((select array_agg(l) from jsonb_array_elements_text(item -> 'labels') l), '{}'),
        (item ->> 'start_date')::date, (item ->> 'due_date')::date, (item ->> 'estimate')::numeric,
        (item ->> 'number')::integer,
        coalesce((item ->> 'created_at')::timestamptz, now()), coalesce((item ->> 'updated_at')::timestamptz, now()),
        case when category = 'done' then coalesce((item ->> 'done_at')::timestamptz, (item ->> 'updated_at')::timestamptz, now()) end,
        jsonb_strip_nulls(coalesce(item -> 'custom', '{}'::jsonb)), item ->> 'external_key', item ->> 'external_url'
      )
      returning id into new_id;
      insert into public.task_events (workspace_id, task_id, actor_id, field, new_value, created_at)
      values (project.workspace_id, new_id, (item ->> 'reporter_id')::uuid, 'created', to_jsonb(left(btrim(item ->> 'title'), 300)),
              coalesce((item ->> 'created_at')::timestamptz, now()));
      made := made + 1;
    end if;
  end loop;
  update public.task_projects set next_number = greatest(next_number, top + 1) where id = target_project;
  perform set_config('ek.importing', 'off', true);
  perform set_config('ek.by_rule', 'off', true);
  return jsonb_build_object('ok', true, 'created', made, 'updated', updated);
end;
$$;
drop function public.list_import_people(uuid);
drop function public.seat_import_person(uuid, uuid);
drop function public.import_people(uuid, jsonb);
drop function public.grant_import_role(public.task_import_people);
drop index public.tasks_reporter_slot_idx;
drop index public.tasks_assignee_slot_idx;
alter table public.tasks drop column reporter_slot, drop column assignee_slot;
drop table public.task_import_people;
