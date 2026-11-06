-- Boards per team in a team's own database (as supabase/migrations/20261213100000_task_boards.sql).
-- Rollback: supabase/team/rollbacks/0029_task_boards.down.sql

-- 1. Boards: the project's main board (no row) and team boards, each bound to a group
-- and/or open to more groups. A column belongs to one board.
create table public.task_boards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null references public.task_projects (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  group_id      uuid references public.workspace_groups (id) on delete set null,
  position      double precision not null default 0,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index task_boards_project_idx on public.task_boards (project_id, position);
create table public.task_board_access (
  board_id      uuid not null references public.task_boards (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  group_id      uuid not null references public.workspace_groups (id) on delete cascade,
  primary key (board_id, group_id)
);
alter table public.task_statuses add column board_id uuid references public.task_boards (id) on delete cascade;
-- A column where a task stops for this board: its people then see only a snapshot.
alter table public.task_statuses add column freezes boolean not null default false;
-- Whether only the project owner and workspace admins may move a frozen task.
alter table public.task_projects add column frozen_moves_admin boolean not null default true;
alter table public.task_rules add column move_to_status uuid references public.task_statuses (id) on delete cascade;

-- 2. Where a task stands on each board (the home board mirrors tasks.status_id).
create table public.task_placements (
  task_id       uuid not null references public.tasks (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  board_key     uuid not null,
  board_id      uuid references public.task_boards (id) on delete cascade,
  status_id     uuid not null references public.task_statuses (id) on delete cascade,
  frozen_at     timestamptz,
  snapshot      jsonb,
  updated_at    timestamptz not null default now(),
  primary key (task_id, board_key)
);
create index task_placements_status_idx on public.task_placements (status_id);
alter table public.task_boards enable row level security;
alter table public.task_board_access enable row level security;
alter table public.task_placements enable row level security;
revoke all on public.task_boards, public.task_board_access, public.task_placements from public, anon, authenticated;
grant select on public.task_boards, public.task_board_access, public.task_placements to authenticated;

create function public.check_task_board_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'task_boards' then
    if (select p.workspace_id from public.task_projects p where p.id = new.project_id) is distinct from new.workspace_id
       or (new.group_id is not null and (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) is distinct from new.workspace_id) then
      raise exception 'board outside its workspace';
    end if;
  elsif tg_table_name = 'task_board_access' then
    if (select b.workspace_id from public.task_boards b where b.id = new.board_id) is distinct from new.workspace_id
       or (select g.workspace_id from public.workspace_groups g where g.id = new.group_id) is distinct from new.workspace_id then
      raise exception 'board access outside its workspace';
    end if;
  else
    if (select t.workspace_id from public.tasks t where t.id = new.task_id) is distinct from new.workspace_id
       or (select s.project_id from public.task_statuses s where s.id = new.status_id) is distinct from (select t.project_id from public.tasks t where t.id = new.task_id)
       or (select s.board_id from public.task_statuses s where s.id = new.status_id) is distinct from new.board_id
       or new.board_key is distinct from coalesce(new.board_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      raise exception 'placement outside its task''s project';
    end if;
  end if;
  return new;
end;
$$;
create trigger task_boards_same_workspace before insert or update on public.task_boards
  for each row execute function public.check_task_board_workspace();
create trigger task_board_access_same_workspace before insert or update on public.task_board_access
  for each row execute function public.check_task_board_workspace();
create trigger task_placements_same_workspace before insert or update on public.task_placements
  for each row execute function public.check_task_board_workspace();

-- 3. Who sees a board: the main board and boards with no team are the project's;
-- otherwise the bound group, groups given access, the project owner and workspace admins.
create function public.board_visible_to(target_board uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_board is null or exists (
    select 1 from public.task_boards b
    where b.id = target_board
      and (public.task_project_role_of(b.project_id, person) = 'owner'
           or exists (select 1 from public.workspace_members m where m.workspace_id = b.workspace_id and m.user_id = person
                      and m.status = 'active' and m.role in ('owner', 'admin'))
           or (b.group_id is null and not exists (select 1 from public.task_board_access a where a.board_id = b.id))
           or exists (select 1 from public.workspace_group_members g where g.user_id = person
                      and (g.group_id = b.group_id or g.group_id in (select a.group_id from public.task_board_access a where a.board_id = b.id)))));
$$;

-- For row rules: whether the signed-in person may open this board.
create function public.board_visible(target_board uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.board_visible_to(target_board, auth.uid());
$$;

-- When a person sees a task only on boards where it is frozen: the moment of the
-- last freeze (they see the task as it was then). Null: they see it live.
create function public.task_cutoff_for(target uuid, person uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.tasks t where t.id = target
                 and (public.task_project_role_of(t.project_id, person) = 'owner'
                      or exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = person
                                 and m.status = 'active' and m.role in ('owner', 'admin')))) then null
    when exists (select 1 from public.task_placements p where p.task_id = target and p.frozen_at is null
                 and public.board_visible_to(p.board_id, person)) then null
    else (select max(p.frozen_at) from public.task_placements p where p.task_id = target and public.board_visible_to(p.board_id, person))
  end;
$$;

create function public.task_cutoff(target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select public.task_cutoff_for(target, auth.uid());
$$;

create function public.task_on_visible_board(target uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_placements p where p.task_id = target and public.board_visible_to(p.board_id, person))
      or not exists (select 1 from public.task_placements p where p.task_id = target);
$$;

-- A task is seen only on boards the person may open.
create or replace function public.task_visible_to(target uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.task_on_visible_board(target, person) and exists (
    select 1 from public.tasks t
    where t.id = target
      and (not t.private
           or person in (t.reporter_id, t.assignee_id)
           or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = person)
           or (public.admins_see_private_tasks(t.workspace_id)
               and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = person
                           and m.status = 'active' and m.role in ('owner', 'admin')))));
$$;

-- A frozen task can't be changed by those who see only its snapshot.
create or replace function public.task_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, auth.uid()) and public.task_cutoff(target) is null
              then public.task_project_role((select t.project_id from public.tasks t where t.id = target)) end;
$$;

-- A frozen task can't be changed by those who see only its snapshot.
create or replace function public.task_role_of(target uuid, person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, person) and public.task_cutoff_for(target, person) is null
              then public.task_project_role_of((select t.project_id from public.tasks t where t.id = target), person) end;
$$;

-- A rule may also place the task in a column of another board.
create or replace function public.save_task_rule(target_project uuid, rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  saved uuid;
  users uuid[];
  groups uuid[];
  roles text[];
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if (select count(*) from public.task_rules r where r.project_id = target_project) >= 30 then
    return public.page_error('too_many');
  end if;
  begin
    users := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(rule -> 'users') v), '{}');
    groups := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(rule -> 'groups') v), '{}');
    roles := coalesce((select array_agg(distinct v) from jsonb_array_elements_text(rule -> 'roles') v), '{}');
  exception when others then
    return public.page_error('invalid');
  end;
  if nullif(rule ->> 'move_to_status', '') is not null and not exists (
       select 1 from public.task_statuses s where s.id::text = rule ->> 'move_to_status' and s.project_id = target_project) then
    return public.page_error('invalid');
  end if;
  if (cardinality(users) + cardinality(groups) + cardinality(roles) = 0 and nullif(rule ->> 'move_to_status', '') is null) or cardinality(users) > 50
     or exists (select 1 from unnest(users) u where not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = u and m.status = 'active'))
     or exists (select 1 from unnest(groups) g where not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = ws)) then
    return public.page_error('invalid');
  end if;
  begin
    insert into public.task_rules (workspace_id, project_id, event, category, status_id, notify_roles, notify_users, notify_groups, move_to_status, created_by)
    values (ws, target_project, rule ->> 'event', nullif(rule ->> 'category', ''), nullif(rule ->> 'status_id', '')::uuid, roles, users, groups, nullif(rule ->> 'move_to_status', '')::uuid, auth.uid())
    returning id into saved;
  exception when others then
    return public.page_error('invalid');
  end;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

-- How far back a person may read a task: 'infinity' live, the freeze moment for a
-- snapshot, null when they don't see it at all.
create function public.task_read_until(target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, auth.uid())
                   and public.task_project_role((select t.project_id from public.tasks t where t.id = target)) is not null
              then coalesce(public.task_cutoff(target), 'infinity'::timestamptz) end;
$$;

drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and public.task_read_until(id) = 'infinity'::timestamptz);
drop policy "Members see comments on tasks open to them" on public.task_comments;
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));
drop policy "Members see the history of tasks open to them" on public.task_events;
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));
drop policy "Members see files of tasks open to them" on public.task_files;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));
create policy "Members see the boards open to them"
  on public.task_boards for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and public.board_visible(id));
create policy "Members see who may open the boards of projects open to them"
  on public.task_board_access for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select b.project_id from public.task_boards b where b.id = board_id)) is not null);
create policy "Members see task places on boards open to them"
  on public.task_placements for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.board_visible(board_id)
         and public.task_read_until(task_id) is not null);

-- 4. The home board follows tasks.status_id.
create function public.sync_home_placement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  board uuid := (select s.board_id from public.task_statuses s where s.id = new.status_id);
begin
  insert into public.task_placements (task_id, workspace_id, board_key, board_id, status_id)
  values (new.id, new.workspace_id, coalesce(board, '00000000-0000-0000-0000-000000000000'::uuid), board, new.status_id)
  on conflict (task_id, board_key) do update set status_id = excluded.status_id, updated_at = now()
  where public.task_placements.status_id is distinct from excluded.status_id;
  return new;
end;
$$;
create trigger tasks_home_placement after insert or update of status_id on public.tasks
  for each row execute function public.sync_home_placement();

insert into public.task_placements (task_id, workspace_id, board_key, board_id, status_id)
select t.id, t.workspace_id, '00000000-0000-0000-0000-000000000000'::uuid, null, t.status_id from public.tasks t;

-- Puts a task in a column of any board: the home board through the task itself.
create function public.place_task(target uuid, column_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  board uuid := (select s.board_id from public.task_statuses s where s.id = column_id);
begin
  select * into task from public.tasks t where t.id = target;
  if (select s.board_id from public.task_statuses s where s.id = task.status_id) is not distinct from board then
    update public.tasks set status_id = column_id, updated_at = now() where id = target and status_id is distinct from column_id;
  else
    insert into public.task_placements (task_id, workspace_id, board_key, board_id, status_id)
    values (target, task.workspace_id, coalesce(board, '00000000-0000-0000-0000-000000000000'::uuid), board, column_id)
    on conflict (task_id, board_key) do update set status_id = excluded.status_id, updated_at = now()
    where public.task_placements.status_id is distinct from excluded.status_id;
  end if;
end;
$$;

-- 5. Freezing (with the snapshot) and rules between boards.
create function public.placement_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select s.freezes from public.task_statuses s where s.id = new.status_id) then
    if new.frozen_at is null then
      new.frozen_at := now();
      new.snapshot := (select jsonb_build_object('id', t.id, 'number', t.number, 'title', t.title, 'description', t.description,
                        'type', t.type, 'priority', t.priority, 'assignee_id', t.assignee_id, 'reporter_id', t.reporter_id,
                        'labels', t.labels, 'start_date', t.start_date, 'due_date', t.due_date, 'estimate', t.estimate, 'custom', t.custom)
                       from public.tasks t where t.id = new.task_id);
    end if;
  else
    new.frozen_at := null;
    new.snapshot := null;
  end if;
  return new;
end;
$$;
create trigger task_placements_freeze before insert or update of status_id on public.task_placements
  for each row execute function public.placement_freeze();

create function public.placement_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.task_rules;
  cat text := (select s.category from public.task_statuses s where s.id = new.status_id);
  project uuid := (select t.project_id from public.tasks t where t.id = new.task_id);
begin
  -- Only a person's move starts rules; a move a rule made starts nothing.
  if coalesce(current_setting('ek.by_rule', true), '') = 'on' then
    return new;
  end if;
  for rule in select * from public.task_rules r where r.project_id = project and r.move_to_status is not null
                and ((r.event = 'enter_status' and r.status_id = new.status_id) or (r.event = 'enter_category' and r.category = cat))
                and r.move_to_status is distinct from new.status_id loop
    perform set_config('ek.by_rule', 'on', true);
    perform public.place_task(new.task_id, rule.move_to_status);
    perform set_config('ek.by_rule', 'off', true);
  end loop;
  return new;
end;
$$;
create trigger task_placements_rules after insert or update of status_id on public.task_placements
  for each row execute function public.placement_rules();

-- 6. A person moves a task on a board.
create function public.move_task_on_board(target uuid, column_id uuid)
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

-- 7. Boards, their access, frozen columns and the project's switch (project owner).
create function public.save_task_board(target_project uuid, target_board uuid, new_name text, team uuid, extra_groups uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 40
     or exists (select 1 from unnest(array_append(coalesce(extra_groups, '{}'), team)) g
                where g is not null and not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = ws)) then
    return public.page_error('invalid');
  end if;
  if target_board is null then
    insert into public.task_boards (workspace_id, project_id, name, group_id, position, created_by)
    values (ws, target_project, btrim(new_name), team,
            coalesce((select max(b.position) from public.task_boards b where b.project_id = target_project), 0) + 1, auth.uid())
    returning id into saved;
  else
    update public.task_boards set name = btrim(new_name), group_id = team
    where id = target_board and project_id = target_project returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  delete from public.task_board_access where board_id = saved;
  insert into public.task_board_access (board_id, workspace_id, group_id)
  select distinct saved, ws, g from unnest(coalesce(extra_groups, '{}')) g;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

create function public.delete_task_board(target_board uuid, move_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  board public.task_boards;
begin
  select * into board from public.task_boards b where b.id = target_board;
  if not found or coalesce(public.task_project_role(board.project_id), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.task_statuses s where s.id = move_to and s.project_id = board.project_id
                 and s.board_id is distinct from target_board) then
    return public.page_error('invalid');
  end if;
  delete from public.task_rules r
  where r.status_id in (select s.id from public.task_statuses s where s.board_id = target_board)
     or r.move_to_status in (select s.id from public.task_statuses s where s.board_id = target_board);
  -- Tasks whose home is this board move home to the column given; others just leave it.
  perform set_config('ek.by_rule', 'on', true);
  update public.tasks set status_id = move_to, updated_at = now(), updated_by = auth.uid()
  where status_id in (select s.id from public.task_statuses s where s.board_id = target_board);
  perform set_config('ek.by_rule', 'off', true);
  delete from public.task_boards where id = target_board;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_task_status_board(target_status uuid, target_board uuid, freezing boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project uuid := (select s.project_id from public.task_statuses s where s.id = target_status);
begin
  if coalesce(public.task_project_role(project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if target_board is not null and not exists (select 1 from public.task_boards b where b.id = target_board and b.project_id = project) then
    return public.page_error('invalid');
  end if;
  if exists (select 1 from public.tasks t where t.status_id = target_status)
     and (select s.board_id from public.task_statuses s where s.id = target_status) is distinct from target_board then
    return public.page_error('not_empty');
  end if;
  update public.task_statuses set board_id = target_board, freezes = coalesce(freezing, freezes) where id = target_status;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_frozen_moves_admin(target_project uuid, admin_only boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  update public.task_projects set frozen_moves_admin = coalesce(admin_only, true) where id = target_project;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.check_task_board_workspace(), public.board_visible_to(uuid, uuid), public.task_cutoff_for(uuid, uuid),
  public.task_on_visible_board(uuid, uuid), public.sync_home_placement(), public.place_task(uuid, uuid),
  public.placement_freeze(), public.placement_rules() from public, anon, authenticated;
revoke execute on function public.board_visible(uuid), public.task_cutoff(uuid), public.task_read_until(uuid), public.move_task_on_board(uuid, uuid),
  public.save_task_board(uuid, uuid, text, uuid, uuid[]), public.delete_task_board(uuid, uuid),
  public.set_task_status_board(uuid, uuid, boolean), public.set_frozen_moves_admin(uuid, boolean) from public, anon;
grant execute on function public.board_visible(uuid), public.task_cutoff(uuid), public.task_read_until(uuid), public.move_task_on_board(uuid, uuid),
  public.save_task_board(uuid, uuid, text, uuid, uuid[]), public.delete_task_board(uuid, uuid),
  public.set_task_status_board(uuid, uuid, boolean), public.set_frozen_moves_admin(uuid, boolean) to authenticated;
