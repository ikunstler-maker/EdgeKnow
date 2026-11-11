-- Rukh, package 2: status buttons (a column's short name and colour), who may move tasks
-- out of and into a column, and rules for a task leaving a column or changing in it.
-- The same in supabase/migrations/20270109100000_column_rules.sql.
-- Rollback: supabase/team/rollbacks/0054_column_rules.down.sql

-- A column's own settings: a short name and a colour for the status button, and who may
-- take a task out of it or put one into it (units; empty: everyone, as before). The
-- project's owner and the workspace's admins always may.
alter table public.task_statuses
  add column short_name text check (short_name is null or char_length(btrim(short_name)) between 1 and 12),
  add column color text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  add column take_groups uuid[] not null default '{}' check (cardinality(take_groups) <= 30),
  add column put_groups uuid[] not null default '{}' check (cardinality(put_groups) <= 30);

create function public.set_column_options(target_status uuid, options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  col public.task_statuses;
  take uuid[];
  put uuid[];
begin
  select * into col from public.task_statuses where id = target_status;
  -- coalesce: someone with no role at all must be refused, not let through by "unknown".
  if col.id is null
     or not (coalesce(public.task_project_role(col.project_id) = 'owner', false) or coalesce(public.is_workspace_admin(col.workspace_id), false)) then
    return public.page_error('forbidden');
  end if;
  begin
    take := case when options ? 'take_groups' then coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(options -> 'take_groups') v), '{}') else col.take_groups end;
    put := case when options ? 'put_groups' then coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(options -> 'put_groups') v), '{}') else col.put_groups end;
  exception when others then
    return public.page_error('invalid');
  end;
  if cardinality(take) > 30 or cardinality(put) > 30
     or exists (select 1 from unnest(take || put) g where not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = col.workspace_id))
     or (options ? 'short_name' and char_length(btrim(coalesce(options ->> 'short_name', ''))) > 12)
     or (options ? 'color' and coalesce(options ->> 'color', '') <> '' and (options ->> 'color') !~ '^#[0-9a-f]{6}$') then
    return public.page_error('invalid');
  end if;
  update public.task_statuses set
    short_name = case when options ? 'short_name' then nullif(btrim(coalesce(options ->> 'short_name', '')), '') else short_name end,
    color = case when options ? 'color' then nullif(options ->> 'color', '') else color end,
    take_groups = take,
    put_groups = put
  where id = target_status;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_column_options(uuid, jsonb) from public, anon;
grant execute on function public.set_column_options(uuid, jsonb) to authenticated;

-- May this person take a task out of / put a task into a column?
create function public.column_allows(col public.task_statuses, what text, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.task_project_role_of(col.project_id, person) = 'owner', false)
      or exists (select 1 from public.workspace_members m where m.workspace_id = col.workspace_id and m.user_id = person and m.status = 'active' and m.role in ('owner', 'admin'))
      or case what
           when 'take' then cardinality(col.take_groups) = 0 or exists (select 1 from unnest(col.take_groups) g where public.unit_reaches(g, person))
           else cardinality(col.put_groups) = 0 or exists (select 1 from unnest(col.put_groups) g where public.unit_reaches(g, person))
         end;
$$;
revoke execute on function public.column_allows(public.task_statuses, text, uuid) from public, anon, authenticated;

-- Every move of a task between columns passes here (dragging, the status buttons, bulk
-- changes: they all end in the task's place on a board). A move a rule makes after a
-- person's own move, an import and the server itself are not asked.
create function public.placement_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
  col public.task_statuses;
begin
  if who is null or coalesce(current_setting('ek.importing', true), '') = 'on' or coalesce(current_setting('ek.by_rule', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.status_id is not distinct from old.status_id then
      return new;
    end if;
    select * into col from public.task_statuses where id = old.status_id;
    if col.id is not null and not public.column_allows(col, 'take', who) then
      raise exception 'column_take_forbidden' using errcode = 'P0001';
    end if;
  end if;
  select * into col from public.task_statuses where id = new.status_id;
  if col.id is not null and not public.column_allows(col, 'put', who) then
    raise exception 'column_put_forbidden' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger task_placements_gate before insert or update of status_id on public.task_placements
  for each row execute function public.placement_gate();

-- For the status buttons: which columns of the project this person may take from and put into.
create function public.column_moves(target_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_project_role(target_project) is null then '{}'::jsonb else coalesce((
    select jsonb_object_agg(s.id, jsonb_build_object('take', public.column_allows(s, 'take', auth.uid()), 'put', public.column_allows(s, 'put', auth.uid())))
    from public.task_statuses s where s.project_id = target_project), '{}'::jsonb) end;
$$;
revoke execute on function public.column_moves(uuid) from public, anon;
grant execute on function public.column_moves(uuid) to authenticated;

-- Rules can also fire when a task leaves a column, or changes while it stands in one.
alter table public.task_rules drop constraint task_rules_event_check;
alter table public.task_rules add constraint task_rules_event_check
  check (event in ('enter_category', 'enter_status', 'leave_status', 'change_in_status', 'assigned', 'comment', 'due_changed'));
alter table public.task_rules drop constraint task_rules_check1;
alter table public.task_rules add constraint task_rules_check1
  check ((event in ('enter_status', 'leave_status', 'change_in_status')) = (status_id is not null));

create or replace function public.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.task_rules;
  cat text;
  actor uuid := auth.uid();
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    cat := (select s.category from public.task_statuses s where s.id = new.status_id);
    for rule in select * from public.task_rules r where r.project_id = new.project_id
                  and ((r.event = 'enter_status' and r.status_id = new.status_id) or (r.event = 'enter_category' and r.category = cat)) loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  -- The column it left.
  if tg_op = 'UPDATE' and new.status_id is distinct from old.status_id then
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'leave_status' and r.status_id = old.status_id loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  -- Changed while standing in its column. Typing a description saves many times:
  -- that alone tells people at most once in half an hour.
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id
     and (new.title is distinct from old.title or new.assignee_id is distinct from old.assignee_id or new.due_date is distinct from old.due_date
          or new.priority is distinct from old.priority or new.description is distinct from old.description)
     and not ((new.title, new.assignee_id, new.due_date, new.priority) is not distinct from (old.title, old.assignee_id, old.due_date, old.priority)
              and exists (select 1 from public.notifications n where n.task_id = new.id and n.kind = 'rule' and n.created_at > now() - interval '30 minutes')) then
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'change_in_status' and r.status_id = new.status_id loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'assigned', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'assigned' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'due', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'due_changed' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of status_id, assignee_id, due_date, title, priority, description on public.tasks
  for each row when (coalesce(current_setting('ek.importing', true), '') <> 'on') execute function public.notify_task_change();
