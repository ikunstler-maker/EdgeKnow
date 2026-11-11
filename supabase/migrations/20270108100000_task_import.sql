-- Rukh, step Р-3а: tasks move in from another tracker (same numbers, dates and people),
-- a project can change its key, and an import can join a project that has tasks.
-- The task part is the same in supabase/team/migrations/0053_task_import.sql; the imports
-- table (with the tracker's encrypted key) exists only here.
-- Rollback: supabase/rollbacks/20270108100000_task_import.down.sql

-- Where an imported task came from (its key and address in the old tracker), and the
-- names of its author and assignee when they are not members here.
alter table public.tasks
  add column external_key text check (external_key is null or char_length(external_key) between 1 and 60),
  add column external_url text check (external_url is null or (char_length(external_url) <= 500 and external_url like 'https://%')),
  add column imported_reporter text check (imported_reporter is null or char_length(imported_reporter) <= 120),
  add column imported_assignee text check (imported_assignee is null or char_length(imported_assignee) <= 120);
create unique index tasks_external_key_idx on public.tasks (project_id, external_key) where external_key is not null;
create index tasks_external_lookup_idx on public.tasks (workspace_id, upper(external_key)) where external_key is not null;

-- While tasks are being imported nobody is told about them and no "changed" lines are
-- written for the import itself (the import writes the original "created" line).
drop trigger tasks_history on public.tasks;
create trigger tasks_history after insert or update on public.tasks
  for each row when (coalesce(current_setting('ek.importing', true), '') <> 'on') execute function public.record_task_events();
drop trigger tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of status_id, assignee_id, due_date on public.tasks
  for each row when (coalesce(current_setting('ek.importing', true), '') <> 'on') execute function public.notify_task_change();

-- Tasks from another tracker, a batch at a time (server only). Each keeps its number,
-- dates and people; a task already imported (same old key) is brought up to date
-- instead of made twice. Items: [{external_key, external_url, number, title, description,
-- status_id, type, priority, assignee_id, reporter_id, imported_assignee, imported_reporter,
-- labels, start_date, due_date, estimate, created_at, updated_at, done_at, custom}].
create function public.import_tasks(target_project uuid, items jsonb)
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
revoke execute on function public.import_tasks(uuid, jsonb) from public, anon, authenticated;

-- After the tasks are in: who is under whom, and the links between them (server only).
-- Items: [{external_key, parent_key, links: [{kind, other_key}]}]; a task that isn't
-- here (not imported, or of another tracker project) is skipped and counted.
create function public.import_task_relations(target_project uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  item jsonb;
  link jsonb;
  task uuid;
  other uuid;
  parents integer := 0;
  links integer := 0;
  missing integer := 0;
begin
  if ws is null then
    return public.page_error('not_found');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 500 then
    return public.page_error('invalid');
  end if;
  perform set_config('ek.importing', 'on', true);
  for item in select * from jsonb_array_elements(items) loop
    select t.id into task from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
    if task is null then
      continue;
    end if;
    if coalesce(item ->> 'parent_key', '') <> '' then
      select t.id into other from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'parent_key';
      if other is null or other = task then
        missing := missing + 1;
      else
        update public.tasks set parent_id = other where id = task and parent_id is distinct from other;
        parents := parents + 1;
      end if;
    end if;
    for link in select * from jsonb_array_elements(coalesce(item -> 'links', '[]'::jsonb)) loop
      -- The other task: in this project first, else anywhere in the workspace.
      select t.id into other from public.tasks t
      where t.workspace_id = ws and t.external_key = link ->> 'other_key'
      order by (t.project_id = target_project) desc limit 1;
      if other is null or other = task or (link ->> 'kind') not in ('blocks', 'relates', 'duplicates') then
        missing := missing + 1;
        continue;
      end if;
      insert into public.task_links (workspace_id, source_id, target_id, kind) values (ws, task, other, link ->> 'kind')
      on conflict do nothing;
      links := links + 1;
    end loop;
  end loop;
  perform set_config('ek.importing', 'off', true);
  return jsonb_build_object('ok', true, 'parents', parents, 'links', links, 'missing', missing);
end;
$$;
revoke execute on function public.import_task_relations(uuid, jsonb) from public, anon, authenticated;

-- Joining an import with a project that already has tasks: the project's own tasks
-- move to numbers after the old tracker's last one, in their order (server only).
create function public.make_room_for_import(target_project uuid, last_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base integer;
  moved integer;
begin
  perform 1 from public.task_projects where id = target_project for update;
  if not found or last_number is null or last_number < 1 then
    return public.page_error('invalid');
  end if;
  select greatest(last_number, coalesce(max(t.number), 0)) into base from public.tasks t where t.project_id = target_project;
  perform set_config('ek.importing', 'on', true);
  with own as (
    select t.id, row_number() over (order by t.number) as place
    from public.tasks t
    where t.project_id = target_project and t.external_key is null and t.number <= last_number
  )
  update public.tasks t set number = base + own.place from own where own.id = t.id;
  get diagnostics moved = row_count;
  perform set_config('ek.importing', 'off', true);
  update public.task_projects set next_number = greatest(next_number, base + moved + 1) where id = target_project;
  return jsonb_build_object('ok', true, 'moved', moved);
end;
$$;
revoke execute on function public.make_room_for_import(uuid, integer) from public, anon, authenticated;

-- A project's key can change (to free it for an import, or after a rename): by the
-- project's owner or a workspace admin, to a key no project of the workspace has.
-- Its tasks keep their numbers under the new key; the change is written to the log.
create function public.set_task_project_key(target_project uuid, new_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  wanted text := upper(btrim(coalesce(new_key, '')));
begin
  select * into project from public.task_projects where id = target_project;
  -- coalesce: for someone with no role at all both answers are "unknown", which must refuse.
  if project.id is null
     or not (coalesce(public.task_project_role(target_project) = 'owner', false) or coalesce(public.is_workspace_admin(project.workspace_id), false)) then
    return public.page_error('forbidden');
  end if;
  if wanted !~ '^[A-Z][A-Z0-9]{1,9}$' then
    return public.page_error('invalid_key');
  end if;
  if wanted = project.key then
    return jsonb_build_object('ok', true, 'key', wanted);
  end if;
  if exists (select 1 from public.task_projects p where p.workspace_id = project.workspace_id and p.key = wanted) then
    return public.page_error('key_taken');
  end if;
  update public.task_projects set key = wanted where id = target_project;
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (project.workspace_id, auth.uid(), 'task_project_key_changed', jsonb_build_object('project', target_project, 'from', project.key, 'to', wanted));
  return jsonb_build_object('ok', true, 'key', wanted);
end;
$$;
revoke execute on function public.set_task_project_key(uuid, text) from public, anon;
grant execute on function public.set_task_project_key(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_tasks(uuid, jsonb) to service_role;
    grant execute on function public.import_task_relations(uuid, jsonb) to service_role;
    grant execute on function public.make_room_for_import(uuid, integer) to service_role;
  end if;
end $$;

-- Imports from another tracker: where from, the key to it (encrypted), how its statuses,
-- people and fields map to ours, how far the move has got and what it reported.
-- Only the server reads or writes this table.
create table public.task_imports (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  -- The project the tasks go to (it may live in the team's own database: no foreign key).
  project_id        uuid,
  source            text not null check (source in ('jira_cloud')),
  site              text not null check (char_length(site) between 9 and 200 and site like 'https://%'),
  source_project    text not null check (source_project ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  account           text not null check (char_length(account) between 3 and 200),
  secret_encrypted  text not null,
  mode              text not null default 'new' check (mode in ('new', 'merge')),
  mapping           jsonb not null default '{}'::jsonb,
  state             text not null default 'draft' check (state in ('draft', 'running', 'done', 'failed')),
  progress          jsonb not null default '{}'::jsonb,
  report            jsonb not null default '{}'::jsonb,
  last_error        text check (last_error is null or char_length(last_error) <= 300),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index task_imports_workspace_idx on public.task_imports (workspace_id, created_at desc);
alter table public.task_imports enable row level security;
-- No policies: only the server (secret key) reads or writes this table.
revoke all on public.task_imports from public, anon, authenticated;
