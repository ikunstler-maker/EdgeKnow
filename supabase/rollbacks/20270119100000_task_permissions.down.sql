-- Undo 20270119100000_task_permissions (the projects' own permissions are forgotten; the usual rules hold again).
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
                            assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, updated_by, custom, private)
  values (
    project.workspace_id, target_project, new_number, btrim(fields ->> 'title'), fields -> 'description', status,
    coalesce(fields ->> 'type', 'task'), coalesce(fields ->> 'priority', 'medium'),
    (fields ->> 'assignee_id')::uuid, auth.uid(),
    coalesce((select array_agg(l) from jsonb_array_elements_text(fields -> 'labels') l), '{}'),
    (fields ->> 'start_date')::date, (fields ->> 'due_date')::date, (fields ->> 'estimate')::numeric,
    (fields ->> 'parent_id')::uuid,
    coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1,
    auth.uid(),
    jsonb_strip_nulls(coalesce(fields -> 'custom', '{}'::jsonb)),
    coalesce((fields ->> 'private')::boolean, false)
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
  if not found or task.deleted_at is not null or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
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
  -- A task can't be its own parent, nor a parent of one of its parents.
  if (changes ->> 'parent_id') is not null and exists (
    with recursive up (id, depth) as (
      select (changes ->> 'parent_id')::uuid, 1
      union all
      select t.parent_id, up.depth + 1 from public.tasks t join up on t.id = up.id
      where t.parent_id is not null and up.depth < 100
    )
    select 1 from up where up.id = target_task
  ) then
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

create or replace function public.delete_task(target_task uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
begin
  select * into task from public.tasks where id = target_task;
  if not found or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
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

create or replace function public.move_task_on_board(target uuid, column_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  board uuid := (select s.board_id from public.task_statuses s where s.id = column_id);
  here public.task_placements;
  admin boolean;
begin
  select * into task from public.tasks t where t.id = target;
  if not found or task.deleted_at is not null or public.task_read_until(target) is null
     or (select s.project_id from public.task_statuses s where s.id = column_id) is distinct from task.project_id
     or not public.board_visible_to(board, auth.uid()) then
    return public.page_error('forbidden');
  end if;
  select * into here from public.task_placements p where p.task_id = target and p.board_key = coalesce(board, '00000000-0000-0000-0000-000000000000'::uuid);
  admin := public.task_project_role(task.project_id) = 'owner'
           or exists (select 1 from public.workspace_members m where m.workspace_id = task.workspace_id and m.user_id = auth.uid()
                      and m.status = 'active' and m.role in ('owner', 'admin'));
  if here.frozen_at is not null and not admin and (select p.frozen_moves_admin from public.task_projects p where p.id = task.project_id) then
    return public.page_error('frozen');
  end if;
  -- Editors move; someone who sees only a snapshot moves it only when the project allows it.
  if public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  perform public.place_task(target, column_id);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_task_link(source_task uuid, target_task uuid, link_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.tasks;
  target public.tasks;
  new_id uuid;
begin
  select * into source from public.tasks where id = source_task;
  if not found or source.deleted_at is not null or public.role_rank(public.task_role(source.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  select * into target from public.tasks where id = target_task;
  if not found or target.deleted_at is not null or target.workspace_id <> source.workspace_id
     or public.task_role(target.id) is null then
    return public.page_error('task_not_found');
  end if;
  if link_kind not in ('blocks', 'relates', 'duplicates') or source_task = target_task then
    return public.page_error('invalid');
  end if;
  if exists (select 1 from public.task_links l where least(l.source_id, l.target_id) = least(source_task, target_task)
             and greatest(l.source_id, l.target_id) = greatest(source_task, target_task) and l.kind = link_kind) then
    return public.page_error('link_exists');
  end if;
  if (select count(*) from public.task_links l where l.source_id = source_task or l.target_id = source_task) >= 100 then
    return public.page_error('too_many_links');
  end if;
  insert into public.task_links (workspace_id, source_id, target_id, kind, created_by)
  values (source.workspace_id, source_task, target_task, link_kind, auth.uid())
  returning id into new_id;
  insert into public.task_events (workspace_id, task_id, actor_id, field, new_value)
  values (source.workspace_id, source_task, auth.uid(), 'link', jsonb_build_object('kind', link_kind, 'task', target_task)),
         (source.workspace_id, target_task, auth.uid(), 'link', jsonb_build_object('kind', link_kind, 'task', source_task));
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.delete_task_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.task_links;
begin
  select * into link from public.task_links where id = target_link;
  if not found or greatest(
    public.role_rank(public.task_role(link.source_id)),
    public.role_rank(public.task_role(link.target_id))
  ) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  delete from public.task_links where id = target_link;
  insert into public.task_events (workspace_id, task_id, actor_id, field, old_value)
  values (link.workspace_id, link.source_id, auth.uid(), 'unlink', jsonb_build_object('kind', link.kind, 'task', link.target_id)),
         (link.workspace_id, link.target_id, auth.uid(), 'unlink', jsonb_build_object('kind', link.kind, 'task', link.source_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_task_participants(target uuid, people jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select t.workspace_id from public.tasks t where t.id = target);
begin
  if public.role_rank(public.task_role(target)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if jsonb_typeof(coalesce(people, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(people, '[]'::jsonb)) > 30
     or exists (select 1 from jsonb_array_elements(coalesce(people, '[]'::jsonb)) e
                where coalesce(e ->> 'role', '') not in ('co_assignee', 'responsible')
                   or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.status = 'active'
                                  and m.user_id::text = e ->> 'user_id')) then
    return public.page_error('invalid');
  end if;
  delete from public.task_participants where task_id = target;
  insert into public.task_participants (task_id, workspace_id, user_id, role, added_by)
  select distinct on ((e ->> 'user_id')::uuid) target, ws, (e ->> 'user_id')::uuid, e ->> 'role', auth.uid()
  from jsonb_array_elements(coalesce(people, '[]'::jsonb)) e;
  return jsonb_build_object('ok', true);
end;
$$;
drop function public.set_task_permission(uuid, text, jsonb);
drop function public.my_task_permissions(uuid);
drop function public.task_permits(uuid, text);
drop function public.project_permits(uuid, text);
drop function public.task_action_allowed(uuid, text, public.tasks, uuid);
drop table public.task_permissions;
