-- Tasks: time in each column, in a team's own database (as supabase/migrations/20261209100000_task_column_time.sql).
-- Rollback: supabase/team/rollbacks/0025_task_column_time.down.sql

alter table public.task_projects
  add column time_last_column boolean not null default false;

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
  if changes ? 'files_target' and coalesce(changes ->> 'files_target', '') not in ('personal', 'wiki', 'project', 'edgeknow') then
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
    files_target = case when changes ? 'files_target' then changes ->> 'files_target' else files_target end,
    sprints = case when changes ? 'sprints' then coalesce((changes ->> 'sprints')::boolean, sprints) else sprints end,
    time_last_column = case when changes ? 'time_last_column' then coalesce((changes ->> 'time_last_column')::boolean, time_last_column) else time_last_column end,
    archived_at = case when changes ? 'archived' then case when (changes ->> 'archived')::boolean then now() end else archived_at end
  where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;
