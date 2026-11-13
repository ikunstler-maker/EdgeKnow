-- CORE-3: access checks once per query instead of once per row (speed, step 5; owner's
-- approval 2026-11-13). Who sees what does not change: every new rule is the old one
-- rewritten, and the security tests give the same output.
-- Rollback: supabase/rollbacks/20270209100000_core_fast_access.down.sql
--
-- The read rules of pages, tasks and service objects asked "is this person a member of
-- the workspace?" and "what is their role in the project?" for every row, although the
-- answer is the same for all rows of a workspace or project (measured: ~5 ms a task,
-- ~3 ms a page, ~1.5 ms an object). Those answers are now sets computed once per query
-- (an uncorrelated subquery); only what really depends on the row is checked per row.

-- Workspaces where the signed-in person is an active member (exactly is_workspace_member).
create function public.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id);
$$;

-- Task projects open to the signed-in person (task_project_role is not null), or only
-- those they own (role 'owner': project owners and the workspace's owner and admins).
create function public.my_task_project_ids(owner_only boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Only the projects of the person's own workspaces are looked at (task_project_role is
  -- task_project_role_of behind a membership check, done here once per workspace).
  select p.id from public.workspace_members m
  join public.task_projects p on p.workspace_id = m.workspace_id
  where m.user_id = auth.uid() and public.is_workspace_member(m.workspace_id)
    and case when owner_only then public.task_project_role_of(p.id, auth.uid()) = 'owner'
             else public.task_project_role_of(p.id, auth.uid()) is not null end;
$$;

-- A task the signed-in person may see by its own rules (private tasks, boards they see).
create function public.task_visible_to_me(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.task_visible_to(target, auth.uid());
$$;

-- Not hidden from the signed-in person by frozen columns: the frozen part of
-- task_cutoff_for, for someone who doesn't own the project (owners are checked once per
-- query in the rule itself). Same as coalesce(task_cutoff_for(...), 'infinity') = 'infinity'.
create function public.task_not_frozen_for_me(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_placements p where p.task_id = target and p.frozen_at is null
                 and public.board_visible_to(p.board_id, auth.uid()))
      or coalesce((select max(p.frozen_at) from public.task_placements p
                   where p.task_id = target and public.board_visible_to(p.board_id, auth.uid())), 'infinity'::timestamptz)
         = 'infinity'::timestamptz;
$$;

-- The signed-in person's role on a page / a service object; membership is checked by the
-- rule itself (effective_role and service_object_role looked the row and membership up again).
create function public.my_page_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.page_role_of(target, auth.uid());
$$;

create function public.my_object_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.service_object_role_of(target, auth.uid());
$$;

revoke all on function public.my_workspace_ids(), public.my_task_project_ids(boolean), public.task_visible_to_me(uuid),
  public.task_not_frozen_for_me(uuid), public.my_page_role(uuid), public.my_object_role(uuid) from public, anon;
grant execute on function public.my_workspace_ids(), public.my_task_project_ids(boolean), public.task_visible_to_me(uuid),
  public.task_not_frozen_for_me(uuid), public.my_page_role(uuid), public.my_object_role(uuid) to authenticated;

-- The rules, rewritten.
drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (workspace_id in (select public.my_workspace_ids())
         and project_id in (select public.my_task_project_ids())
         and public.task_visible_to_me(id)
         and (project_id in (select public.my_task_project_ids(true)) or public.task_not_frozen_for_me(id)));

drop policy "Members can read pages they have a role on" on public.pages;
create policy "Members can read pages they have a role on"
  on public.pages for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.my_page_role(id) is not null);

drop policy "Members see the objects open to them" on public.service_objects;
create policy "Members see the objects open to them"
  on public.service_objects for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.my_object_role(id) is not null);
