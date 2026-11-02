-- Links between tasks ("blocks", "relates to", "duplicates"), no parent loops,
-- and changing many tasks at once.
-- Subtasks and epics use tasks.parent_id (from step Z1); their progress is counted by the app.
-- RLS: a link shows to those who see at least one of its tasks; the other task's
-- name comes only through the tasks' own RLS, so a hidden task stays hidden.
-- See supabase/migrations/20261124100000_task_links.sql.
-- Rollback: supabase/team/rollbacks/0010_task_links.down.sql

create table public.task_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  source_id     uuid not null references public.tasks (id) on delete cascade,
  target_id     uuid not null references public.tasks (id) on delete cascade,
  -- source blocks / relates to / duplicates target
  kind          text not null check (kind in ('blocks', 'relates', 'duplicates')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (source_id <> target_id)
);
-- One link of a kind between two tasks, whichever way round.
create unique index task_links_pair_idx on public.task_links (least(source_id, target_id), greatest(source_id, target_id), kind);
create index task_links_source_idx on public.task_links (source_id);
create index task_links_target_idx on public.task_links (target_id);

create function public.check_task_link_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.tasks t where t.id = new.source_id)
     or new.workspace_id is distinct from (select t.workspace_id from public.tasks t where t.id = new.target_id) then
    raise exception 'linked tasks must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger task_links_same_workspace before insert or update on public.task_links
  for each row execute function public.check_task_link_workspace();

alter table public.task_links enable row level security;
revoke all on public.task_links from public, anon, authenticated;
grant select on public.task_links to authenticated;
create policy "Members see links of tasks open to them"
  on public.task_links for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and (public.task_project_role((select t.project_id from public.tasks t where t.id = source_id)) is not null
              or public.task_project_role((select t.project_id from public.tasks t where t.id = target_id)) is not null));

-- Link two tasks: an editor of the first one's project, who also sees the second.
create function public.add_task_link(source_task uuid, target_task uuid, link_kind text)
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
  if not found or source.deleted_at is not null or public.role_rank(public.task_project_role(source.project_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  select * into target from public.tasks where id = target_task;
  if not found or target.deleted_at is not null or target.workspace_id <> source.workspace_id
     or public.task_project_role(target.project_id) is null then
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

-- Remove a link: an editor of either task's project.
create function public.delete_task_link(target_link uuid)
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
    public.role_rank(public.task_project_role((select t.project_id from public.tasks t where t.id = link.source_id))),
    public.role_rank(public.task_project_role((select t.project_id from public.tasks t where t.id = link.target_id)))
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

-- Change many tasks at once (up to 200): status, assignee, priority, type,
-- parent (epic), add or remove a label, or move to the bin. Each task goes
-- through update_task/delete_task with its own checks; one refusal undoes all.
create function public.bulk_update_tasks(target_tasks uuid[], changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  one uuid;
  result jsonb;
  own jsonb;
  current_labels text[];
  changed integer := 0;
begin
  if coalesce(cardinality(target_tasks), 0) not between 1 and 200 or jsonb_typeof(changes) <> 'object' or exists (
    select 1 from jsonb_object_keys(changes) key
    where key not in ('status_id', 'assignee_id', 'priority', 'type', 'parent_id', 'add_label', 'remove_label', 'delete')
  ) then
    return public.page_error('invalid');
  end if;
  begin
    foreach one in array target_tasks loop
      if coalesce((changes ->> 'delete')::boolean, false) then
        result := public.delete_task(one, false);
      else
        own := changes - 'add_label' - 'remove_label' - 'delete';
        if changes ? 'add_label' or changes ? 'remove_label' then
          current_labels := coalesce((select t.labels from public.tasks t where t.id = one), '{}');
          current_labels := array_remove(current_labels, changes ->> 'remove_label');
          if nullif(btrim(coalesce(changes ->> 'add_label', '')), '') is not null and not (btrim(changes ->> 'add_label') = any (current_labels)) then
            current_labels := current_labels || btrim(changes ->> 'add_label');
          end if;
          own := own || jsonb_build_object('labels', to_jsonb(current_labels));
        end if;
        result := public.update_task(one, own);
      end if;
      if not coalesce((result ->> 'ok')::boolean, false) then
        raise exception using errcode = 'EK001', message = coalesce(result ->> 'error', 'unknown');
      end if;
      changed := changed + 1;
    end loop;
  exception when sqlstate 'EK001' then
    return public.page_error(sqlerrm) || jsonb_build_object('task', one);
  end;
  return jsonb_build_object('ok', true, 'changed', changed);
end;
$$;

revoke execute on function public.add_task_link(uuid, uuid, text), public.delete_task_link(uuid), public.bulk_update_tasks(uuid[], jsonb) from public, anon;
grant execute on function public.add_task_link(uuid, uuid, text), public.delete_task_link(uuid), public.bulk_update_tasks(uuid[], jsonb) to authenticated;

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
