-- Tasks (see supabase/migrations/20261120100000_tasks.sql): the same task part
-- as centrally, in the team's own database.
-- Rollback: supabase/team/rollbacks/0006_tasks.down.sql

-------------------------------------------------------------------------------
-- Projects
-------------------------------------------------------------------------------

-- A space for tasks in a workspace, with a short key: tasks are MKT-1, MKT-2…
create table public.task_projects (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  key             text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  icon            text check (char_length(icon) <= 16),
  -- Everyone in the workspace gets this role (null: only the people and groups given access).
  workspace_role  text default 'editor' check (workspace_role in ('editor', 'commenter', 'viewer')),
  -- Sprints and the backlog are switched on per project (step 6).
  sprints         boolean not null default false,
  next_number     integer not null default 1,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (workspace_id, key)
);

create table public.task_project_access (
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.task_project_group_access (
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (project_id, group_id)
);

-- Columns of the board; each belongs to one of three groups.
create table public.task_statuses (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  category      text not null check (category in ('todo', 'doing', 'done')),
  position      double precision not null default 0,
  wip_limit     integer check (wip_limit between 1 and 999),
  created_at    timestamptz not null default now()
);
create index task_statuses_project_idx on public.task_statuses (project_id, position);

-------------------------------------------------------------------------------
-- Tasks, comments, history
-------------------------------------------------------------------------------

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  number        integer not null,
  title         text not null check (char_length(btrim(title)) between 1 and 300),
  description   jsonb,
  status_id     uuid not null references public.task_statuses (id),
  type          text not null default 'task' check (type in ('task', 'bug', 'idea', 'epic')),
  priority      text not null default 'medium' check (priority in ('lowest', 'low', 'medium', 'high', 'highest')),
  assignee_id   uuid references public.profiles (id) on delete set null,
  reporter_id   uuid references public.profiles (id) on delete set null,
  labels        text[] not null default '{}' check (cardinality(labels) <= 20),
  start_date    date,
  due_date      date,
  estimate      numeric(8, 2) check (estimate >= 0),
  parent_id     uuid references public.tasks (id) on delete set null,
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  done_at       timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id) on delete set null,
  unique (project_id, number)
);
create index tasks_project_status_idx on public.tasks (project_id, status_id, position) where deleted_at is null;
create index tasks_assignee_idx on public.tasks (assignee_id) where deleted_at is null;
create index tasks_parent_idx on public.tasks (parent_id);

create table public.task_comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  author_id     uuid references public.profiles (id) on delete set null,
  body          text not null check (char_length(btrim(body)) between 1 and 10000),
  mentions      uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- Who changed what and when (written by the trigger below, never by people).
create table public.task_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  field         text not null,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, created_at);

-- Everything of a project stays in its workspace.
create function public.check_task_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select p.workspace_id from public.task_projects p where p.id = new.project_id) then
    raise exception 'task data and project must be in the same workspace';
  end if;
  if tg_table_name = 'tasks' then
    if new.project_id is distinct from (select s.project_id from public.task_statuses s where s.id = new.status_id) then
      raise exception 'the status belongs to another project';
    end if;
    if new.parent_id is not null and new.project_id is distinct from (select t.project_id from public.tasks t where t.id = new.parent_id) then
      raise exception 'the parent task belongs to another project';
    end if;
  end if;
  if tg_table_name = 'task_project_group_access' then
    if new.workspace_id is distinct from (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) then
      raise exception 'group and project must be in the same workspace';
    end if;
  end if;
  return new;
end;
$$;
create trigger task_project_access_same_workspace before insert or update on public.task_project_access
  for each row execute function public.check_task_workspace();
create trigger task_project_group_access_same_workspace before insert or update on public.task_project_group_access
  for each row execute function public.check_task_workspace();
create trigger task_statuses_same_workspace before insert or update on public.task_statuses
  for each row execute function public.check_task_workspace();
create trigger tasks_same_workspace before insert or update of workspace_id, project_id, status_id, parent_id on public.tasks
  for each row execute function public.check_task_workspace();

create function public.check_task_comment_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.tasks t where t.id = new.task_id) then
    raise exception 'comment and task must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger task_comments_same_workspace before insert or update on public.task_comments
  for each row execute function public.check_task_comment_workspace();

-------------------------------------------------------------------------------
-- Who may do what in a project
-------------------------------------------------------------------------------

-- 'owner' (workspace owner and admins, or given), 'editor', 'commenter', 'viewer' or null.
create function public.task_project_role_of(target_project uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with project as (select * from public.task_projects p where p.id = target_project),
  candidates as (
    select 'owner' as role from project p
    join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = member and m.status = 'active'
    where m.role in ('owner', 'admin')
    union all
    select p.workspace_role from project p where p.workspace_role is not null and public.is_active_member(p.workspace_id, member)
    union all
    select a.role from public.task_project_access a where a.project_id = target_project and a.user_id = member
    union all
    select ga.role from public.task_project_group_access ga
    join public.workspace_group_members gm on gm.group_id = ga.group_id and gm.user_id = member
    where ga.project_id = target_project
  )
  select role from candidates where role is not null order by public.role_rank(role) desc limit 1;
$$;

-- The signed-in person's role, checking workspace membership first.
create function public.task_project_role(target_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.task_project_role_of(p.id, auth.uid())
  from public.task_projects p
  where p.id = target_project and public.is_workspace_member(p.workspace_id);
$$;

alter table public.task_projects enable row level security;
alter table public.task_project_access enable row level security;
alter table public.task_project_group_access enable row level security;
alter table public.task_statuses enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_events enable row level security;
revoke all on public.task_projects, public.task_project_access, public.task_project_group_access, public.task_statuses,
  public.tasks, public.task_comments, public.task_events from public, anon, authenticated;
grant select on public.task_projects, public.task_project_access, public.task_project_group_access, public.task_statuses,
  public.tasks, public.task_comments, public.task_events to authenticated;

create policy "Members see the projects open to them"
  on public.task_projects for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(id) is not null);
create policy "Members see who has access to projects open to them"
  on public.task_project_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);
create policy "Members see group access of projects open to them"
  on public.task_project_group_access for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);
create policy "Members see the columns of projects open to them"
  on public.task_statuses for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);

-------------------------------------------------------------------------------
-- History
-------------------------------------------------------------------------------

create function public.record_task_events()
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
  foreach field in array array['title', 'status_id', 'type', 'priority', 'assignee_id', 'labels', 'start_date', 'due_date', 'estimate', 'parent_id', 'deleted_at'] loop
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
create trigger tasks_history after insert or update on public.tasks
  for each row execute function public.record_task_events();

-------------------------------------------------------------------------------
-- Changing things (all through these functions)
-------------------------------------------------------------------------------

-- Workspace owner and admins create projects; the default columns come with it.
create function public.create_task_project(ws uuid, new_name text, new_key text, new_icon text, status_names text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_key text := upper(btrim(coalesce(new_key, '')));
  project_id uuid;
  names text[] := coalesce(status_names, array['To do', 'In progress', 'Done']);
begin
  if not public.is_workspace_member(ws) or not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 80 then
    return public.page_error('invalid_name');
  end if;
  if clean_key !~ '^[A-Z][A-Z0-9]{1,9}$' then
    return public.page_error('invalid_key');
  end if;
  if exists (select 1 from public.task_projects p where p.workspace_id = ws and p.key = clean_key) then
    return public.page_error('key_taken');
  end if;
  if cardinality(names) <> 3 then
    return public.page_error('invalid');
  end if;
  insert into public.task_projects (workspace_id, key, name, icon, created_by)
  values (ws, clean_key, btrim(new_name), nullif(btrim(coalesce(new_icon, '')), ''), auth.uid())
  returning id into project_id;
  insert into public.task_statuses (project_id, workspace_id, name, category, position) values
    (project_id, ws, names[1], 'todo', 1),
    (project_id, ws, names[2], 'doing', 2),
    (project_id, ws, names[3], 'done', 3);
  return jsonb_build_object('ok', true, 'id', project_id, 'key', clean_key);
end;
$$;

create function public.update_task_project(target_project uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if changes ? 'name' and char_length(btrim(coalesce(changes ->> 'name', ''))) not between 1 and 80 then
    return public.page_error('invalid_name');
  end if;
  if changes ? 'workspace_role' and (changes ->> 'workspace_role') is not null
     and (changes ->> 'workspace_role') not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.task_projects set
    name = case when changes ? 'name' then btrim(changes ->> 'name') else name end,
    icon = case when changes ? 'icon' then nullif(btrim(coalesce(changes ->> 'icon', '')), '') else icon end,
    workspace_role = case when changes ? 'workspace_role' then changes ->> 'workspace_role' else workspace_role end,
    sprints = case when changes ? 'sprints' then coalesce((changes ->> 'sprints')::boolean, sprints) else sprints end,
    archived_at = case when changes ? 'archived' then case when (changes ->> 'archived')::boolean then now() end else archived_at end
  where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_task_project_member_role(target_project uuid, member uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into project from public.task_projects where id = target_project;
  if new_role is null then
    delete from public.task_project_access where project_id = target_project and user_id = member;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not public.is_active_member(project.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;
  insert into public.task_project_access (project_id, workspace_id, user_id, role, granted_by)
  values (target_project, project.workspace_id, member, new_role, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_task_project_group_role(target_project uuid, target_group uuid, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  select * into project from public.task_projects where id = target_project;
  if new_role is null then
    delete from public.task_project_group_access where project_id = target_project and group_id = target_group;
    return jsonb_build_object('ok', true);
  end if;
  if new_role not in ('owner', 'editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  if not exists (select 1 from public.workspace_groups g where g.id = target_group and g.workspace_id = project.workspace_id) then
    return public.page_error('not_found');
  end if;
  insert into public.task_project_group_access (project_id, workspace_id, group_id, role, granted_by)
  values (target_project, project.workspace_id, target_group, new_role, auth.uid())
  on conflict (project_id, group_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  return jsonb_build_object('ok', true);
end;
$$;

-- Fields a task may be given; anything else in `fields` is ignored.
create function public.task_fields_valid(project uuid, fields jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = project);
begin
  if fields ? 'title' and char_length(btrim(coalesce(fields ->> 'title', ''))) not between 1 and 300 then
    return 'invalid_title';
  end if;
  if fields ? 'type' and (fields ->> 'type') not in ('task', 'bug', 'idea', 'epic') then
    return 'invalid';
  end if;
  if fields ? 'priority' and (fields ->> 'priority') not in ('lowest', 'low', 'medium', 'high', 'highest') then
    return 'invalid';
  end if;
  if fields ? 'status_id' and not exists (
    select 1 from public.task_statuses s where s.id = (fields ->> 'status_id')::uuid and s.project_id = project
  ) then
    return 'invalid_status';
  end if;
  if (fields ->> 'assignee_id') is not null and not public.is_active_member(ws, (fields ->> 'assignee_id')::uuid) then
    return 'not_a_member';
  end if;
  if (fields ->> 'parent_id') is not null and not exists (
    select 1 from public.tasks t where t.id = (fields ->> 'parent_id')::uuid and t.project_id = project and t.deleted_at is null
  ) then
    return 'invalid_parent';
  end if;
  if fields ? 'labels' and (jsonb_typeof(fields -> 'labels') <> 'array' or jsonb_array_length(fields -> 'labels') > 20
     or exists (select 1 from jsonb_array_elements_text(fields -> 'labels') l where char_length(l) not between 1 and 40)) then
    return 'invalid_labels';
  end if;
  if fields ? 'description' and pg_column_size(fields -> 'description') > 1048576 then
    return 'too_large';
  end if;
  return null;
end;
$$;

-- Anyone who may edit the project makes tasks; the number comes from the project, without gaps or repeats.
create function public.create_task(target_project uuid, fields jsonb)
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
                            assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, updated_by)
  values (
    project.workspace_id, target_project, new_number, btrim(fields ->> 'title'), fields -> 'description', status,
    coalesce(fields ->> 'type', 'task'), coalesce(fields ->> 'priority', 'medium'),
    (fields ->> 'assignee_id')::uuid, auth.uid(),
    coalesce((select array_agg(l) from jsonb_array_elements_text(fields -> 'labels') l), '{}'),
    (fields ->> 'start_date')::date, (fields ->> 'due_date')::date, (fields ->> 'estimate')::numeric,
    (fields ->> 'parent_id')::uuid,
    coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1,
    auth.uid()
  )
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'key', project.key || '-' || new_number, 'number', new_number);
end;
$$;

-- Changes to a task: only the fields given. Moving on the board is a change of status and position.
create function public.update_task(target_task uuid, changes jsonb)
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
    done_at = case when done and done_at is null then now() when not done then null else done_at end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_task;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.delete_task(target_task uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
begin
  select * into task from public.tasks where id = target_task;
  if not found or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.tasks
  set deleted_at = case when restore then null else now() end,
      deleted_by = case when restore then null else auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
  where id = target_task;
  return jsonb_build_object('ok', true);
end;
$$;

-- Commenters and up; mentions only of people in the workspace.
create function public.add_task_comment(target_task uuid, body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  new_id uuid;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('commenter') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(body, ''))) not between 1 and 10000 then
    return public.page_error('invalid');
  end if;
  insert into public.task_comments (workspace_id, task_id, author_id, body, mentions)
  values (task.workspace_id, target_task, auth.uid(), btrim(body),
    coalesce((select array_agg(distinct m) from unnest(mention_ids) m where public.is_active_member(task.workspace_id, m)), '{}'))
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- One's own comment, or any as the project's owner.
create function public.edit_task_comment(target_comment uuid, new_body text, remove boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comment public.task_comments;
  project uuid;
begin
  select * into comment from public.task_comments where id = target_comment;
  if not found then
    return public.page_error('not_found');
  end if;
  project := (select t.project_id from public.tasks t where t.id = comment.task_id);
  if public.task_project_role(project) is null
     or (comment.author_id is distinct from auth.uid() and (not remove or public.task_project_role(project) <> 'owner')) then
    return public.page_error('forbidden');
  end if;
  if remove then
    delete from public.task_comments where id = target_comment;
    return jsonb_build_object('ok', true);
  end if;
  if char_length(btrim(coalesce(new_body, ''))) not between 1 and 10000 then
    return public.page_error('invalid');
  end if;
  update public.task_comments set body = btrim(new_body), edited_at = now() where id = target_comment;
  return jsonb_build_object('ok', true);
end;
$$;

-- Someone who leaves the workspace loses their own project access too.
create function public.drop_task_access_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.task_project_access where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger workspace_members_drop_task_access after update of status on public.workspace_members
  for each row execute function public.drop_task_access_of_removed_member();

revoke execute on function
  public.task_project_role_of(uuid, uuid),
  public.task_fields_valid(uuid, jsonb),
  public.record_task_events(),
  public.drop_task_access_of_removed_member(),
  public.check_task_workspace(),
  public.check_task_comment_workspace()
from public, anon, authenticated;
revoke execute on function
  public.task_project_role(uuid),
  public.create_task_project(uuid, text, text, text, text[]),
  public.update_task_project(uuid, jsonb),
  public.set_task_project_member_role(uuid, uuid, text),
  public.set_task_project_group_role(uuid, uuid, text),
  public.create_task(uuid, jsonb),
  public.update_task(uuid, jsonb),
  public.delete_task(uuid, boolean),
  public.add_task_comment(uuid, text, uuid[]),
  public.edit_task_comment(uuid, text, boolean)
from public, anon;
grant execute on function
  public.task_project_role(uuid),
  public.create_task_project(uuid, text, text, text, text[]),
  public.update_task_project(uuid, jsonb),
  public.set_task_project_member_role(uuid, uuid, text),
  public.set_task_project_group_role(uuid, uuid, text),
  public.create_task(uuid, jsonb),
  public.update_task(uuid, jsonb),
  public.delete_task(uuid, boolean),
  public.add_task_comment(uuid, text, uuid[]),
  public.edit_task_comment(uuid, text, boolean)
to authenticated;
