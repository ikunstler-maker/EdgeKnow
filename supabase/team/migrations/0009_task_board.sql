-- Tasks, step Z2 (see supabase/migrations/20261123100000_task_board.sql).
-- Rollback: supabase/team/rollbacks/0009_task_board.down.sql

alter table public.task_projects
  add column card_fields text[] not null default array['key', 'type', 'priority', 'assignee', 'due', 'labels'];

create or replace function public.update_task_project(target_project uuid, changes jsonb)
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
  -- What a board card shows: built-in fields, or the project's own fields by id.
  if changes ? 'card_fields' and (jsonb_typeof(changes -> 'card_fields') <> 'array' or exists (
    select 1 from jsonb_array_elements_text(changes -> 'card_fields') f
    where f not in ('key', 'type', 'priority', 'assignee', 'reporter', 'labels', 'due', 'start', 'created', 'updated', 'estimate', 'subtasks')
      and not exists (select 1 from public.task_fields tf where tf.id::text = f and tf.project_id = target_project)
  )) then
    return public.page_error('invalid');
  end if;
  if changes ? 'workspace_role' and (changes ->> 'workspace_role') is not null
     and (changes ->> 'workspace_role') not in ('editor', 'commenter', 'viewer') then
    return public.page_error('invalid_role');
  end if;
  update public.task_projects set
    name = case when changes ? 'name' then btrim(changes ->> 'name') else name end,
    icon = case when changes ? 'icon' then nullif(btrim(coalesce(changes ->> 'icon', '')), '') else icon end,
    workspace_role = case when changes ? 'workspace_role' then changes ->> 'workspace_role' else workspace_role end,
    card_fields = case when changes ? 'card_fields' then array(select jsonb_array_elements_text(changes -> 'card_fields')) else card_fields end,
    sprints = case when changes ? 'sprints' then coalesce((changes ->> 'sprints')::boolean, sprints) else sprints end,
    archived_at = case when changes ? 'archived' then case when (changes ->> 'archived')::boolean then now() end else archived_at end
  where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;

-- Add or change a board column (no id: a new one). Project owners only.
create function public.save_task_status(target_project uuid, target_status uuid, new_name text, new_category text, new_wip_limit integer, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 40 then
    return public.page_error('invalid_name');
  end if;
  if new_category not in ('todo', 'doing', 'done') or (new_wip_limit is not null and new_wip_limit not between 1 and 999) then
    return public.page_error('invalid');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if target_status is null then
    if (select count(*) from public.task_statuses s where s.project_id = target_project) >= 20 then
      return public.page_error('too_many_columns');
    end if;
    insert into public.task_statuses (project_id, workspace_id, name, category, wip_limit, position)
    values (target_project, ws, btrim(new_name), new_category, new_wip_limit,
            coalesce(new_position, (select max(s.position) from public.task_statuses s where s.project_id = target_project) + 1, 1))
    returning id into saved;
  else
    update public.task_statuses
    set name = btrim(new_name), category = new_category, wip_limit = new_wip_limit, position = coalesce(new_position, position)
    where id = target_status and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

-- Remove a column; its tasks move to another column of the project. The last column stays.
create function public.delete_task_status(target_status uuid, move_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  column_row public.task_statuses;
begin
  select * into column_row from public.task_statuses where id = target_status;
  if not found or coalesce(public.task_project_role(column_row.project_id), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if (select count(*) from public.task_statuses s where s.project_id = column_row.project_id) <= 1 then
    return public.page_error('last_column');
  end if;
  if exists (select 1 from public.tasks t where t.status_id = target_status) then
    if move_to is null or move_to = target_status
       or not exists (select 1 from public.task_statuses s where s.id = move_to and s.project_id = column_row.project_id) then
      return public.page_error('invalid_status');
    end if;
    update public.tasks set status_id = move_to, updated_at = now(), updated_by = auth.uid() where status_id = target_status;
  end if;
  delete from public.task_statuses where id = target_status;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.save_task_status(uuid, uuid, text, text, integer, double precision), public.delete_task_status(uuid, uuid) from public, anon;
grant execute on function public.save_task_status(uuid, uuid, text, text, integer, double precision), public.delete_task_status(uuid, uuid) to authenticated;
