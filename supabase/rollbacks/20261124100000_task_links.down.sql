-- Undo task links and bulk edit; update_task goes back to checking only "not its own parent".
drop function if exists public.bulk_update_tasks(uuid[], jsonb);
drop function if exists public.delete_task_link(uuid);
drop function if exists public.add_task_link(uuid, uuid, text);
drop table if exists public.task_links;
drop function if exists public.check_task_link_workspace();
delete from public.task_events where field in ('link', 'unlink');

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
