-- Undo 20261213100000_task_boards.sql.

create or replace function public.task_visible_to(target uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target
      and (not t.private
           or person in (t.reporter_id, t.assignee_id)
           or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = person)
           or (public.admins_see_private_tasks(t.workspace_id)
               and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = person
                           and m.status = 'active' and m.role in ('owner', 'admin')))));
$$;

create or replace function public.task_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, auth.uid())
              then public.task_project_role((select t.project_id from public.tasks t where t.id = target)) end;
$$;

create or replace function public.task_role_of(target uuid, person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, person)
              then public.task_project_role_of((select t.project_id from public.tasks t where t.id = target), person) end;
$$;

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
  if cardinality(users) + cardinality(groups) + cardinality(roles) = 0 or cardinality(users) > 50
     or exists (select 1 from unnest(users) u where not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = u and m.status = 'active'))
     or exists (select 1 from unnest(groups) g where not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = ws)) then
    return public.page_error('invalid');
  end if;
  begin
    insert into public.task_rules (workspace_id, project_id, event, category, status_id, notify_roles, notify_users, notify_groups, created_by)
    values (ws, target_project, rule ->> 'event', nullif(rule ->> 'category', ''), nullif(rule ->> 'status_id', '')::uuid, roles, users, groups, auth.uid())
    returning id into saved;
  exception when others then
    return public.page_error('invalid');
  end;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

drop policy "Members see files of tasks open to them" on public.task_files;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see the history of tasks open to them" on public.task_events;
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see comments on tasks open to them" on public.task_comments;
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and (not private or public.task_visible(id)));

drop table public.task_placements;
delete from public.task_rules where move_to_status is not null and notify_roles = '{}' and notify_users = '{}' and notify_groups = '{}';
alter table public.task_rules drop column move_to_status;
alter table public.task_projects drop column frozen_moves_admin;
alter table public.task_statuses drop column freezes;
alter table public.task_statuses drop column board_id;
drop table public.task_board_access;
drop table public.task_boards;
drop function public.set_frozen_moves_admin(uuid, boolean);
drop function public.set_task_status_board(uuid, uuid, boolean);
drop function public.delete_task_board(uuid, uuid);
drop function public.save_task_board(uuid, uuid, text, uuid, uuid[]);
drop function public.move_task_on_board(uuid, uuid);
drop function public.placement_rules();
drop function public.placement_freeze();
drop function public.place_task(uuid, uuid);
drop trigger tasks_home_placement on public.tasks;
drop function public.sync_home_placement();
drop function public.task_read_until(uuid);
drop function public.task_on_visible_board(uuid, uuid);
drop function public.task_cutoff(uuid);
drop function public.task_cutoff_for(uuid, uuid);
drop function public.board_visible(uuid);
drop function public.board_visible_to(uuid, uuid);
drop function public.check_task_board_workspace();
