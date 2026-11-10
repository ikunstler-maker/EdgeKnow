-- Faster reads, tasks: a project's tasks in one pass.
-- The same in supabase/team/migrations/0042_fast_tasks.sql.
-- Rollback: supabase/rollbacks/20261227100000_fast_tasks.down.sql
-- No table, policy or rule of access changes: one read-only function.

-- The tasks of one project the caller may read live, worked out in one pass. The
-- same rows as reading public.tasks for that project — the same rules (membership,
-- the project role, boards open to the person, private tasks, frozen columns),
-- written for the whole project at once: the role, "is an admin" and which boards
-- are open are worked out once per call instead of several times per task.
-- supabase/tests/stage52_fast_tasks.sql compares the two ways.
create function public.project_tasks(target_project uuid)
returns setof public.tasks
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select p.workspace_id as ws,
           auth.uid() as me,
           public.is_workspace_member(p.workspace_id) as member,
           public.task_project_role_of(p.id, auth.uid()) as role,
           exists (select 1 from public.workspace_members m
                   where m.workspace_id = p.workspace_id and m.user_id = auth.uid()
                     and m.status = 'active' and m.role in ('owner', 'admin')) as admin,
           public.admins_see_private_tasks(p.workspace_id) as admins_see_private
    from public.task_projects p
    where p.id = target_project
  ),
  -- Where the project's tasks stand, and which of those boards this person sees.
  places as (
    select pl.task_id, pl.board_id, pl.frozen_at
    from public.task_placements pl
    join public.tasks t on t.id = pl.task_id
    where t.project_id = target_project
  ),
  boards as (
    select b.board_id, public.board_visible_to(b.board_id, (select c.me from ctx c)) as visible
    from (select distinct pl.board_id from places pl) b
  ),
  standing as (
    select pl.task_id,
           bool_or(b.visible) as on_visible_board,
           bool_or(b.visible and pl.frozen_at is null) as live_somewhere
    from places pl
    join boards b on b.board_id is not distinct from pl.board_id
    group by pl.task_id
  )
  select t.*
  from public.tasks t
  cross join ctx c
  left join standing s on s.task_id = t.id
  where t.project_id = target_project
    and c.member
    and c.role is not null
    -- On a board the person sees (or on no board at all).
    and (s.task_id is null or s.on_visible_board)
    -- A private task: its people, or admins where the workspace lets them.
    and (not t.private
         or c.me in (t.reporter_id, t.assignee_id)
         or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = c.me)
         or (c.admins_see_private and c.admin))
    -- Frozen for this person on every board they see: only the snapshot, not the live task.
    and (c.role = 'owner' or c.admin or s.task_id is null or s.live_somewhere);
$$;

revoke execute on function public.project_tasks(uuid) from public, anon;
grant execute on function public.project_tasks(uuid) to authenticated;
