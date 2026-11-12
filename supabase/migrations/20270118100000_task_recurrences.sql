-- Rukh, package 4-3: repeating tasks — every N days, weeks, months or years.
-- The same in supabase/team/migrations/0063_task_recurrences.sql.
-- Rollback: supabase/rollbacks/20270118100000_task_recurrences.down.sql

-- A task can repeat: every N days, weeks (on chosen weekdays), months or years, from a
-- date on, until a date or without end. On each date a copy of the task is made.
create table public.task_recurrences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- The task the copies are made from.
  task_id       uuid not null unique references public.tasks (id) on delete cascade,
  every_n       integer not null check (every_n between 1 and 366),
  unit          text not null check (unit in ('day', 'week', 'month', 'year')),
  -- For weeks: the days of the week (1 Monday … 7 Sunday); empty: the same day as the start.
  weekdays      smallint[] not null default '{}' check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  next_on       date not null,
  until         date,
  -- The latest copy: when it is done before the next date, the next copy is made at once.
  last_task_id  uuid references public.tasks (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index task_recurrences_next_idx on public.task_recurrences (next_on);
create index task_recurrences_last_idx on public.task_recurrences (last_task_id) where last_task_id is not null;
alter table public.task_recurrences enable row level security;
revoke all on public.task_recurrences from public, anon, authenticated;
grant select on public.task_recurrences to authenticated;
create policy task_recurrences_select on public.task_recurrences for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);

-- The date after `d` by the rule.
create function public.recurrence_after(d date, every_n integer, unit text, weekdays smallint[])
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when unit = 'week' and cardinality(weekdays) > 0 then coalesce(
      -- A later chosen day in the same week…
      (select min(d + (w - extract(isodow from d)::integer)) from unnest(weekdays) w where w > extract(isodow from d)::integer),
      -- …or the first chosen day N weeks on.
      (select min(d - (extract(isodow from d)::integer - 1) + 7 * every_n + (w - 1)) from unnest(weekdays) w))
    when unit = 'day' then d + every_n
    when unit = 'week' then d + 7 * every_n
    when unit = 'month' then (d + make_interval(months => every_n))::date
    else (d + make_interval(years => every_n))::date
  end;
$$;
revoke execute on function public.recurrence_after(date, integer, text, smallint[]) from public, anon;
grant execute on function public.recurrence_after(date, integer, text, smallint[]) to authenticated;

-- Whoever may edit the task says how it repeats: {every, unit, weekdays, start, until};
-- null stops the repeating (copies already made stay).
create function public.set_task_recurrence(target_task uuid, rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  n integer;
  u text;
  days smallint[];
  first date;
  last date;
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or public.role_rank(public.task_role(target_task)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if rule is null or jsonb_typeof(rule) = 'null' then
    delete from public.task_recurrences where task_id = target_task;
    return jsonb_build_object('ok', true);
  end if;
  begin
    n := (rule ->> 'every')::integer;
    u := rule ->> 'unit';
    days := coalesce((select array_agg(distinct v::smallint order by v::smallint) from jsonb_array_elements_text(coalesce(rule -> 'weekdays', '[]'::jsonb)) v), '{}');
    first := coalesce((rule ->> 'start')::date, current_date + 1);
    last := (rule ->> 'until')::date;
  exception when others then
    return public.page_error('invalid');
  end;
  if n is null or n not between 1 and 366 or coalesce(u, '') not in ('day', 'week', 'month', 'year') or not (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
     or first < current_date or first > current_date + 3660 or (last is not null and last < first) then
    return public.page_error('invalid');
  end if;
  if u <> 'week' then
    days := '{}';
  end if;
  -- The first date falls on a chosen weekday.
  if cardinality(days) > 0 and not (extract(isodow from first)::smallint = any (days)) then
    first := public.recurrence_after(first, 1, 'week', days);
  end if;
  insert into public.task_recurrences (workspace_id, task_id, every_n, unit, weekdays, next_on, until, created_by)
  values (task.workspace_id, target_task, n, u, days, first, last, auth.uid())
  on conflict (task_id) do update set every_n = excluded.every_n, unit = excluded.unit, weekdays = excluded.weekdays,
    next_on = excluded.next_on, until = excluded.until;
  return jsonb_build_object('ok', true, 'next_on', first);
end;
$$;
revoke execute on function public.set_task_recurrence(uuid, jsonb) from public, anon;
grant execute on function public.set_task_recurrence(uuid, jsonb) to authenticated;

-- Makes the next copy of a repeating task and moves the rule on. The copy starts on the
-- rule's date and is due as long after it as the first task was; it goes to the
-- project's first "to do" column with the same people, fields and labels.
create function public.spawn_task_recurrence(target_rule uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.task_recurrences;
  source public.tasks;
  project public.task_projects;
  status uuid;
  new_id uuid;
  following date;
begin
  select * into rule from public.task_recurrences where id = target_rule for update;
  if rule.id is null then
    return null;
  end if;
  select * into source from public.tasks where id = rule.task_id;
  if source.id is null or source.deleted_at is not null or (rule.until is not null and rule.next_on > rule.until) then
    delete from public.task_recurrences where id = rule.id;
    return null;
  end if;
  update public.task_projects set next_number = next_number + 1 where id = source.project_id and archived_at is null returning * into project;
  if project.id is null then
    return null;
  end if;
  select s.id into status from public.task_statuses s where s.project_id = source.project_id and s.board_id is null
  order by case s.category when 'todo' then 0 when 'doing' then 1 else 2 end, s.position limit 1;
  insert into public.tasks (workspace_id, project_id, number, title, description, status_id, type, priority, assignee_id, reporter_id, labels,
                            start_date, due_date, estimate, parent_id, position, custom, private)
  values (source.workspace_id, source.project_id, project.next_number - 1, source.title, source.description, status, source.type, source.priority,
          source.assignee_id, source.reporter_id, source.labels, rule.next_on,
          case when source.due_date is not null then rule.next_on + greatest(source.due_date - coalesce(source.start_date, source.due_date), 0) end,
          source.estimate, source.parent_id, coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1, source.custom, source.private)
  returning id into new_id;
  insert into public.task_participants (task_id, workspace_id, user_id, role, added_by)
  select new_id, p.workspace_id, p.user_id, p.role, p.added_by from public.task_participants p where p.task_id = source.id;
  following := public.recurrence_after(rule.next_on, rule.every_n, rule.unit, rule.weekdays);
  if rule.until is not null and following > rule.until then
    delete from public.task_recurrences where id = rule.id;
  else
    update public.task_recurrences set next_on = following, last_task_id = new_id where id = rule.id;
  end if;
  return new_id;
end;
$$;
revoke execute on function public.spawn_task_recurrence(uuid) from public, anon, authenticated;

-- Once a day (server only): every rule whose date has come makes its copy (a rule left
-- far behind catches up by at most three copies a run).
create function public.run_task_recurrences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule record;
  made integer := 0;
  turn integer;
begin
  for rule in select id from public.task_recurrences where next_on <= current_date order by next_on limit 500 loop
    turn := 0;
    while turn < 3 and exists (select 1 from public.task_recurrences r where r.id = rule.id and r.next_on <= current_date) loop
      if public.spawn_task_recurrence(rule.id) is null then
        exit;
      end if;
      made := made + 1;
      turn := turn + 1;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'made', made);
end;
$$;
revoke execute on function public.run_task_recurrences() from public, anon, authenticated;

-- The latest copy done before the next date: the next copy is made at once.
create function public.recurrence_on_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule uuid;
begin
  -- Only a move into a "done" column from a column that is not one.
  if (select s.category from public.task_statuses s where s.id = new.status_id) is distinct from 'done'
     or (select s.category from public.task_statuses s where s.id = old.status_id) = 'done' then
    return new;
  end if;
  select r.id into rule from public.task_recurrences r
  where r.last_task_id = new.id or (r.task_id = new.id and r.last_task_id is null) limit 1;
  if rule is not null then
    perform public.spawn_task_recurrence(rule);
  end if;
  return new;
end;
$$;
create trigger tasks_recurrence_done after update of status_id on public.tasks
  for each row when (new.status_id is distinct from old.status_id and coalesce(current_setting('ek.importing', true), '') <> 'on')
  execute function public.recurrence_on_done();
