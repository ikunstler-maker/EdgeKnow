-- Rukh, package 4-1: time spent on tasks — a project turns it on and says who sees it;
-- entries come over from the tracker too.
-- The same in supabase/team/migrations/0061_time_tracking.sql.
-- Rollback: supabase/rollbacks/20270116100000_time_tracking.down.sql

-- Time tracking is a project's choice: off (as before) or on, and who sees the entries —
-- only the project's owners (and workspace admins), they and the task's assignee, or
-- everyone who sees the task. A person always sees their own entries.
alter table public.task_projects
  add column time_tracking boolean not null default false,
  add column time_visibility text not null default 'assignee' check (time_visibility in ('owners', 'assignee', 'all'));

create table public.task_time_entries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  user_id       uuid references public.profiles (id) on delete set null,
  -- An entry that came from the tracker: the tracker's person (a seat) and its id there.
  author_slot   uuid references public.task_import_people (id) on delete set null,
  external_id   text check (external_id is null or char_length(external_id) between 1 and 100),
  minutes       integer not null check (minutes between 1 and 100000),
  spent_on      date not null,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index task_time_entries_task_idx on public.task_time_entries (task_id, spent_on);
create index task_time_entries_user_idx on public.task_time_entries (workspace_id, user_id, spent_on);
create unique index task_time_entries_external_idx on public.task_time_entries (task_id, external_id) where external_id is not null;
create index task_time_entries_slot_idx on public.task_time_entries (author_slot) where author_slot is not null;
alter table public.task_time_entries enable row level security;
revoke all on public.task_time_entries from public, anon, authenticated;
grant select on public.task_time_entries to authenticated;

-- May the asker see this task's time entries of other people?
create function public.sees_task_time(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.time_tracking and (
             coalesce(public.task_project_role(p.id) = 'owner', false)
             or p.time_visibility = 'all'
             or (p.time_visibility = 'assignee' and t.assignee_id = auth.uid()))
    from public.tasks t join public.task_projects p on p.id = t.project_id
    where t.id = target_task), false);
$$;
revoke execute on function public.sees_task_time(uuid) from public, anon;
grant execute on function public.sees_task_time(uuid) to authenticated;

create policy task_time_entries_select on public.task_time_entries for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id)
         and (user_id = auth.uid() or public.sees_task_time(task_id)));

-- The project's owner turns time tracking on or off and says who sees the entries.
create function public.set_project_time_tracking(target_project uuid, enabled boolean, visibility text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if enabled is null or coalesce(visibility, '') not in ('owners', 'assignee', 'all') then
    return public.page_error('invalid');
  end if;
  update public.task_projects set time_tracking = enabled, time_visibility = visibility where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_project_time_tracking(uuid, boolean, text) from public, anon;
grant execute on function public.set_project_time_tracking(uuid, boolean, text) to authenticated;

-- A person writes down the time they spent on a task (whoever may edit the task, where the
-- project tracks time), or changes an entry: `target_entry` null makes a new one.
create function public.save_task_time(target_task uuid, target_entry uuid, spent_minutes integer, spent_date date, new_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  entry public.task_time_entries;
  entry_id uuid;
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or public.role_rank(public.task_role(target_task)) < public.role_rank('editor')
     or not coalesce((select p.time_tracking from public.task_projects p where p.id = task.project_id), false) then
    return public.page_error('forbidden');
  end if;
  if spent_minutes is null or spent_minutes not between 1 and 100000 or spent_date is null
     or spent_date > current_date + 1 or spent_date < current_date - 3650 or char_length(coalesce(new_note, '')) > 500 then
    return public.page_error('invalid');
  end if;
  if target_entry is null then
    insert into public.task_time_entries (workspace_id, task_id, user_id, minutes, spent_on, note)
    values (task.workspace_id, target_task, auth.uid(), spent_minutes, spent_date, nullif(btrim(coalesce(new_note, '')), ''))
    returning id into entry_id;
    return jsonb_build_object('ok', true, 'id', entry_id);
  end if;
  select * into entry from public.task_time_entries where id = target_entry and task_id = target_task;
  -- One's own entry, or any entry for the project's owner.
  if entry.id is null or not (entry.user_id = auth.uid() or coalesce(public.task_project_role(task.project_id) = 'owner', false)) then
    return public.page_error('forbidden');
  end if;
  update public.task_time_entries set minutes = spent_minutes, spent_on = spent_date, note = nullif(btrim(coalesce(new_note, '')), ''), updated_at = now()
  where id = target_entry;
  return jsonb_build_object('ok', true, 'id', target_entry);
end;
$$;
revoke execute on function public.save_task_time(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.save_task_time(uuid, uuid, integer, date, text) to authenticated;

create function public.delete_task_time(target_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.task_time_entries;
begin
  select * into entry from public.task_time_entries where id = target_entry;
  if entry.id is null or public.task_role(entry.task_id) is null
     or not (entry.user_id = auth.uid()
             or coalesce(public.task_project_role((select t.project_id from public.tasks t where t.id = entry.task_id)) = 'owner', false)) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_time_entries where id = target_entry;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.delete_task_time(uuid) from public, anon;
grant execute on function public.delete_task_time(uuid) to authenticated;

-- The project's time by person within dates, for its owners: [{user_id, name, minutes, tasks}].
create function public.project_time_report(target_project uuid, date_from date, date_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(public.task_project_role(target_project) = 'owner', false) then coalesce((
    select jsonb_agg(jsonb_build_object('user_id', q.user_id, 'name', q.name, 'minutes', q.minutes, 'tasks', q.tasks) order by q.minutes desc)
    from (
      select e.user_id, coalesce(max(s.name), '') as name, sum(e.minutes) as minutes, count(distinct e.task_id) as tasks
      from public.task_time_entries e
      join public.tasks t on t.id = e.task_id
      left join public.task_import_people s on s.id = e.author_slot and e.user_id is null
      where t.project_id = target_project and t.deleted_at is null
        and e.spent_on between coalesce(date_from, '0001-01-01') and coalesce(date_to, '9999-12-31')
      group by e.user_id, case when e.user_id is null then e.author_slot end
    ) q), '[]'::jsonb) end;
$$;
revoke execute on function public.project_time_report(uuid, date, date) from public, anon;
grant execute on function public.project_time_report(uuid, date, date) to authenticated;

-- The import brings the tracker's time entries (server only). Items: [{external_key,
-- entries: [{external_id, author_ext, minutes, spent_on, note}]}]. A project that gets
-- entries starts tracking time. A second run replaces, never doubles.
create function public.import_task_time(target_project uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  item jsonb;
  entry jsonb;
  task uuid;
  seat public.task_import_people;
  made integer := 0;
begin
  select * into project from public.task_projects where id = target_project;
  if project.id is null then
    return public.page_error('not_found');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    return public.page_error('invalid');
  end if;
  for item in select * from jsonb_array_elements(items) loop
    select t.id into task from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
    if task is null then
      continue;
    end if;
    for entry in select * from jsonb_array_elements(coalesce(item -> 'entries', '[]'::jsonb)) with ordinality as x(value, n) where n <= 2000 loop
      if coalesce(entry ->> 'external_id', '') = '' or coalesce((entry ->> 'minutes')::integer, 0) < 1 or (entry ->> 'spent_on') is null then
        continue;
      end if;
      seat := null;
      select * into seat from public.task_import_people p where p.project_id = target_project and p.external_id = entry ->> 'author_ext';
      insert into public.task_time_entries (workspace_id, task_id, user_id, author_slot, external_id, minutes, spent_on, note, created_at)
      values (project.workspace_id, task, seat.user_id, seat.id, left(entry ->> 'external_id', 100), least((entry ->> 'minutes')::integer, 100000),
              (entry ->> 'spent_on')::date, nullif(left(btrim(coalesce(entry ->> 'note', '')), 500), ''), ((entry ->> 'spent_on')::date)::timestamptz)
      on conflict (task_id, external_id) where external_id is not null do update set
        minutes = excluded.minutes, spent_on = excluded.spent_on, note = excluded.note, author_slot = excluded.author_slot,
        user_id = coalesce(public.task_time_entries.user_id, excluded.user_id), updated_at = now();
      made := made + 1;
    end loop;
  end loop;
  if made > 0 and not project.time_tracking then
    update public.task_projects set time_tracking = true where id = target_project;
  end if;
  return jsonb_build_object('ok', true, 'entries', made);
end;
$$;
revoke execute on function public.import_task_time(uuid, jsonb) from public, anon, authenticated;

-- Seating a person hands over the time they wrote down in the tracker as well.
create or replace function public.seat_import_person(target_person uuid, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.task_import_people;
  previous uuid;
  held integer;
  wrote integer;
  said integer;
begin
  select * into person from public.task_import_people where id = target_person for update;
  if person.id is null
     or not (coalesce(public.task_project_role(person.project_id) = 'owner', false) or coalesce(public.is_workspace_admin(person.workspace_id), false)) then
    return public.page_error('forbidden');
  end if;
  if member is not null and not public.is_active_member(person.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;
  previous := person.user_id;
  perform set_config('ek.importing', 'on', true);
  perform set_config('ek.by_rule', 'on', true);
  update public.tasks set assignee_id = member, imported_assignee = case when member is null then person.name end
  where assignee_slot = person.id and assignee_id is not distinct from previous;
  get diagnostics held = row_count;
  update public.tasks set reporter_id = member, imported_reporter = case when member is null then person.name end
  where reporter_slot = person.id and reporter_id is not distinct from previous;
  get diagnostics wrote = row_count;
  -- The person's comments and history lines go with the seat too.
  update public.task_comments set author_id = member where author_slot = person.id and author_id is not distinct from previous;
  get diagnostics said = row_count;
  update public.task_events set actor_id = member where actor_slot = person.id and actor_id is not distinct from previous;
  update public.task_files set uploaded_by = member where uploader_slot = person.id and uploaded_by is not distinct from previous;
  update public.task_time_entries set user_id = member where author_slot = person.id and user_id is not distinct from previous;
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote, 'comments', said);
end;
$$;
