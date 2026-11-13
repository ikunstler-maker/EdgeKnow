-- CORE-5: access checks once per query, part 2 (speed; owner's approval 2026-11-13). Who sees
-- what does not change: every rule below is the old one rewritten, and the equivalence tests
-- compare them for every test person.
-- Rollback: supabase/rollbacks/20270212100000_core_fast_access_2.down.sql
--
-- 1. Pages: the role on every live page of the person's workspaces in one pass (the same pass
--    as the page tree, my_page_tree) instead of walking up the tree for each row; pages in the
--    bin keep the per-row check (there are few, and the tree pass leaves them out).
-- 2. Comments, history, files, links, time and board places of tasks: membership and the
--    project's role once per query, then only the task's own rules per row.

create function public.my_readable_page_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.my_workspace_ids() w(id), lateral public.my_page_tree(w.id) t;
$$;

-- The task's project (a cheap lookup the rules use to test it against the person's projects).
create function public.task_project_of(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.project_id from public.tasks t where t.id = target;
$$;

-- How far back the person reads a task's records when they don't own its project: the frozen
-- part of task_cutoff_for, 'infinity' when nothing is frozen for them.
create function public.task_frozen_until_for_me(target uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.task_placements p where p.task_id = target and p.frozen_at is null
                 and public.board_visible_to(p.board_id, auth.uid())) then 'infinity'::timestamptz
    else coalesce((select max(p.frozen_at) from public.task_placements p
                   where p.task_id = target and public.board_visible_to(p.board_id, auth.uid())), 'infinity'::timestamptz)
  end;
$$;

revoke all on function public.my_readable_page_ids(), public.task_project_of(uuid), public.task_frozen_until_for_me(uuid) from public, anon;
grant execute on function public.my_readable_page_ids(), public.task_project_of(uuid), public.task_frozen_until_for_me(uuid) to authenticated;

drop policy "Members can read pages they have a role on" on public.pages;
create policy "Members can read pages they have a role on"
  on public.pages for select to authenticated
  using (workspace_id in (select public.my_workspace_ids())
         and (id in (select public.my_readable_page_ids())
              or (deleted_at is not null and public.my_page_role(id) is not null)));

drop policy "Members see comments on tasks open to them" on public.task_comments;
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end);

drop policy "Members see the history of tasks open to them" on public.task_events;
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end);

drop policy "Members see files of tasks open to them" on public.task_files;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end);

drop policy "Members see task places on boards open to them" on public.task_placements;
create policy "Members see task places on boards open to them"
  on public.task_placements for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.board_visible(board_id)
         and public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id));

drop policy "task_time_entries_select" on public.task_time_entries;
create policy "task_time_entries_select"
  on public.task_time_entries for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end
         and (user_id = auth.uid() or public.sees_task_time(task_id)));

drop policy "task_web_links_select" on public.task_web_links;
create policy "task_web_links_select"
  on public.task_web_links for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end);

drop policy "task_wishlist_links_select" on public.task_wishlist_links;
create policy "task_wishlist_links_select"
  on public.task_wishlist_links for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and created_at <= case
             when public.task_project_of(task_id) in (select public.my_task_project_ids(true)) and public.task_visible_to_me(task_id) then 'infinity'::timestamptz
             when public.task_project_of(task_id) in (select public.my_task_project_ids()) and public.task_visible_to_me(task_id) then public.task_frozen_until_for_me(task_id)
           end);

