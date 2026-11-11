-- Rukh, package 3 (part 1): the tracker's people as seats that are tied to members and can
-- be re-seated, the tracker's project roles as roles of ours, restricted tasks as private.
-- The same in supabase/migrations/20270110100000_import_people.sql.
-- Rollback: supabase/team/rollbacks/0055_import_people.down.sql

-- People of the tracker the tasks came from. Each is a seat: a name (and an email, when
-- the tracker shows it) that is tied to a member of ours at once or later, and can be
-- re-seated; the tasks the person held or wrote follow the seat.
create table public.task_import_people (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  -- The person's id in the tracker; empty for names kept as text by earlier imports.
  external_id   text check (external_id is null or char_length(external_id) between 1 and 200),
  name          text not null check (char_length(name) between 1 and 120),
  email         text check (email is null or char_length(email) <= 320),
  -- The person's roles in the tracker's project, and the role of ours they map to.
  tracker_roles text[] not null default '{}' check (cardinality(tracker_roles) <= 20),
  project_role  text check (project_role is null or project_role in ('owner', 'editor', 'commenter', 'viewer')),
  user_id       uuid references public.profiles (id) on delete set null,
  seated_by     uuid references public.profiles (id) on delete set null,
  seated_at     timestamptz,
  created_at    timestamptz not null default now()
);
create unique index task_import_people_external_idx on public.task_import_people (project_id, external_id) where external_id is not null;
create unique index task_import_people_name_idx on public.task_import_people (project_id, lower(name)) where external_id is null;
create index task_import_people_user_idx on public.task_import_people (user_id) where user_id is not null;
alter table public.task_import_people enable row level security;
revoke all on public.task_import_people from public, anon, authenticated;
grant select on public.task_import_people to authenticated;
-- Seen by those who see the project; written only by the functions below.
create policy task_import_people_select on public.task_import_people for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);

alter table public.tasks
  add column assignee_slot uuid references public.task_import_people (id) on delete set null,
  add column reporter_slot uuid references public.task_import_people (id) on delete set null;
create index tasks_assignee_slot_idx on public.tasks (assignee_slot) where assignee_slot is not null;
create index tasks_reporter_slot_idx on public.tasks (reporter_slot) where reporter_slot is not null;

-- Names that earlier imports kept as text become seats (nobody is told, no history lines).
set ek.importing = 'on';
insert into public.task_import_people (workspace_id, project_id, name)
select distinct on (q.project_id, lower(q.name)) q.workspace_id, q.project_id, q.name
from (
  select t.workspace_id, t.project_id, left(btrim(t.imported_assignee), 120) as name from public.tasks t where btrim(coalesce(t.imported_assignee, '')) <> ''
  union all
  select t.workspace_id, t.project_id, left(btrim(t.imported_reporter), 120) from public.tasks t where btrim(coalesce(t.imported_reporter, '')) <> ''
) q
order by q.project_id, lower(q.name);
update public.tasks t set assignee_slot = p.id from public.task_import_people p
where p.project_id = t.project_id and p.external_id is null and lower(p.name) = lower(left(btrim(t.imported_assignee), 120));
update public.tasks t set reporter_slot = p.id from public.task_import_people p
where p.project_id = t.project_id and p.external_id is null and lower(p.name) = lower(left(btrim(t.imported_reporter), 120));
reset ek.importing;

-- A seated person gets the role their tracker role maps to (never lowers what they have).
create function public.grant_import_role(person public.task_import_people)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := person.project_role;
begin
  if person.user_id is null or wanted is null or not public.is_active_member(person.workspace_id, person.user_id) then
    return;
  end if;
  if wanted = 'owner' and public.is_guest(person.workspace_id, person.user_id) then
    wanted := 'editor';
  end if;
  if public.role_rank(coalesce(public.task_project_role_of(person.project_id, person.user_id), '')) >= public.role_rank(wanted) then
    return;
  end if;
  insert into public.task_project_access (project_id, workspace_id, user_id, role, granted_by)
  values (person.project_id, person.workspace_id, person.user_id, wanted, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
end;
$$;
revoke execute on function public.grant_import_role(public.task_import_people) from public, anon, authenticated;

-- The import brings the tracker's people (server only). Items: [{external_id, name, email,
-- roles: [text], project_role, user_id}]; `user_id` is the member chosen in the wizard.
-- Without one, a person whose email is a member's email is seated at once. A seat that is
-- already taken is left with whoever sits there.
create function public.import_people(target_project uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  item jsonb;
  person public.task_import_people;
  member uuid;
  seated integer := 0;
  total integer := 0;
begin
  select * into project from public.task_projects where id = target_project;
  if project.id is null then
    return public.page_error('not_found');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 500 then
    return public.page_error('invalid');
  end if;
  for item in select * from jsonb_array_elements(items) loop
    if coalesce(item ->> 'external_id', '') = '' or btrim(coalesce(item ->> 'name', '')) = ''
       or coalesce(item ->> 'project_role', 'viewer') not in ('owner', 'editor', 'commenter', 'viewer') then
      return public.page_error('invalid');
    end if;
    member := (item ->> 'user_id')::uuid;
    if member is null and coalesce(item ->> 'email', '') <> '' then
      select m.user_id into member from public.workspace_members m join public.profiles pr on pr.id = m.user_id
      where m.workspace_id = project.workspace_id and m.status = 'active' and lower(pr.email) = lower(item ->> 'email') limit 1;
    end if;
    if member is not null and not public.is_active_member(project.workspace_id, member) then
      member := null;
    end if;
    select * into person from public.task_import_people p where p.project_id = target_project and p.external_id = item ->> 'external_id';
    if person.id is null then
      -- A name an earlier import kept as text is this person.
      select * into person from public.task_import_people p
      where p.project_id = target_project and p.external_id is null and lower(p.name) = lower(left(btrim(item ->> 'name'), 120));
    end if;
    if person.id is null then
      insert into public.task_import_people (workspace_id, project_id, external_id, name, email, tracker_roles, project_role, user_id, seated_at)
      values (project.workspace_id, target_project, item ->> 'external_id', left(btrim(item ->> 'name'), 120), nullif(left(item ->> 'email', 320), ''),
              coalesce((select array_agg(left(r, 120)) from jsonb_array_elements_text(item -> 'roles') with ordinality as x(r, n) where n <= 20), '{}'),
              item ->> 'project_role', member, case when member is not null then now() end)
      returning * into person;
    else
      update public.task_import_people p set
        external_id = item ->> 'external_id',
        name = left(btrim(item ->> 'name'), 120),
        email = coalesce(nullif(left(item ->> 'email', 320), ''), p.email),
        tracker_roles = case when item ? 'roles' then coalesce((select array_agg(left(r, 120)) from jsonb_array_elements_text(item -> 'roles') with ordinality as x(r, n) where n <= 20), '{}') else p.tracker_roles end,
        project_role = case when item ? 'project_role' then item ->> 'project_role' else p.project_role end,
        user_id = coalesce(p.user_id, member),
        seated_at = case when p.user_id is null and member is not null then now() else p.seated_at end
      where p.id = person.id
      returning * into person;
    end if;
    perform public.grant_import_role(person);
    total := total + 1;
    if person.user_id is not null then
      seated := seated + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'people', total, 'seated', seated);
end;
$$;
revoke execute on function public.import_people(uuid, jsonb) from public, anon, authenticated;

-- Seat a tracker person on a member (or free the seat with null): the tasks the person
-- held or wrote go to the member — those still with whoever sat there before; a task
-- someone handed to another person meanwhile stays. The project's owner or a workspace
-- admin. Nobody is told and no history lines are written: it can be thousands of tasks.
create function public.seat_import_person(target_person uuid, member uuid)
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
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote);
end;
$$;
revoke execute on function public.seat_import_person(uuid, uuid) from public, anon;
grant execute on function public.seat_import_person(uuid, uuid) to authenticated;

-- The project's tracker people with how many tasks each holds and wrote (the project's
-- owner or a workspace admin; private tasks are counted, not shown).
create function public.list_import_people(target_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(public.task_project_role(target_project) = 'owner', false)
                or coalesce(public.is_workspace_admin((select p.workspace_id from public.task_projects p where p.id = target_project)), false)
  then coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'tracker_roles', p.tracker_roles, 'project_role', p.project_role,
                                        'user_id', p.user_id,
                                        'assigned', (select count(*) from public.tasks t where t.assignee_slot = p.id and t.deleted_at is null),
                                        'reported', (select count(*) from public.tasks t where t.reporter_slot = p.id and t.deleted_at is null))
                     order by (p.user_id is not null), lower(p.name))
    from public.task_import_people p where p.project_id = target_project), '[]'::jsonb)
  end;
$$;
revoke execute on function public.list_import_people(uuid) from public, anon;
grant execute on function public.list_import_people(uuid) to authenticated;

-- The import also ties each task to the seats of its assignee and author (`assignee_ext`,
-- `reporter_ext`: the tracker's ids) and keeps a restricted task private (`private`).
create or replace function public.import_tasks(target_project uuid, items jsonb)
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
  holder public.task_import_people;
  writer public.task_import_people;
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
    -- The tracker's people behind the task: their seats, and whoever sits on them.
    holder := null;
    writer := null;
    select * into holder from public.task_import_people p where p.project_id = target_project and p.external_id = item ->> 'assignee_ext';
    select * into writer from public.task_import_people p where p.project_id = target_project and p.external_id = item ->> 'reporter_ext';
    select t.id into existing from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
    if existing is not null then
      update public.tasks set
        title = left(btrim(item ->> 'title'), 300),
        description = item -> 'description',
        status_id = (item ->> 'status_id')::uuid,
        type = coalesce(item ->> 'type', 'task'),
        priority = coalesce(item ->> 'priority', 'medium'),
        assignee_id = coalesce((item ->> 'assignee_id')::uuid, holder.user_id),
        assignee_slot = holder.id,
        reporter_id = coalesce((item ->> 'reporter_id')::uuid, writer.user_id),
        reporter_slot = writer.id,
        imported_assignee = case when coalesce((item ->> 'assignee_id')::uuid, holder.user_id) is null then left(item ->> 'imported_assignee', 120) end,
        imported_reporter = case when coalesce((item ->> 'reporter_id')::uuid, writer.user_id) is null then left(item ->> 'imported_reporter', 120) end,
        labels = coalesce((select array_agg(l) from jsonb_array_elements_text(item -> 'labels') l), '{}'),
        start_date = (item ->> 'start_date')::date,
        due_date = (item ->> 'due_date')::date,
        estimate = (item ->> 'estimate')::numeric,
        external_url = item ->> 'external_url',
        private = coalesce((item ->> 'private')::boolean, private),
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
                                done_at, custom, external_key, external_url, assignee_slot, reporter_slot, private)
      values (
        project.workspace_id, target_project, (item ->> 'number')::integer, left(btrim(item ->> 'title'), 300), item -> 'description',
        (item ->> 'status_id')::uuid, coalesce(item ->> 'type', 'task'), coalesce(item ->> 'priority', 'medium'),
        coalesce((item ->> 'assignee_id')::uuid, holder.user_id), coalesce((item ->> 'reporter_id')::uuid, writer.user_id),
        case when coalesce((item ->> 'assignee_id')::uuid, holder.user_id) is null then left(item ->> 'imported_assignee', 120) end,
        case when coalesce((item ->> 'reporter_id')::uuid, writer.user_id) is null then left(item ->> 'imported_reporter', 120) end,
        coalesce((select array_agg(l) from jsonb_array_elements_text(item -> 'labels') l), '{}'),
        (item ->> 'start_date')::date, (item ->> 'due_date')::date, (item ->> 'estimate')::numeric,
        (item ->> 'number')::integer,
        coalesce((item ->> 'created_at')::timestamptz, now()), coalesce((item ->> 'updated_at')::timestamptz, now()),
        case when category = 'done' then coalesce((item ->> 'done_at')::timestamptz, (item ->> 'updated_at')::timestamptz, now()) end,
        jsonb_strip_nulls(coalesce(item -> 'custom', '{}'::jsonb)), item ->> 'external_key', item ->> 'external_url',
        holder.id, writer.id, coalesce((item ->> 'private')::boolean, false)
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
