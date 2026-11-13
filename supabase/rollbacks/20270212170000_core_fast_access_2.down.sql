-- Undo 20270212170000_core_fast_access_2: the per-row rules come back.

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

drop policy "Members see task places on boards open to them" on public.task_placements;
create policy "Members see task places on boards open to them"
  on public.task_placements for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.board_visible(board_id) and public.task_read_until(task_id) is not null);

drop policy "task_time_entries_select" on public.task_time_entries;
create policy "task_time_entries_select"
  on public.task_time_entries for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id) and (user_id = auth.uid() or public.sees_task_time(task_id)));

drop policy "task_web_links_select" on public.task_web_links;
create policy "task_web_links_select"
  on public.task_web_links for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));

drop policy "task_wishlist_links_select" on public.task_wishlist_links;
create policy "task_wishlist_links_select"
  on public.task_wishlist_links for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));

drop policy "Members can read pages they have a role on" on public.pages;
create policy "Members can read pages they have a role on"
  on public.pages for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.my_page_role(id) is not null);

drop function public.task_frozen_until_for_me(uuid);
drop function public.task_project_of(uuid);
drop function public.my_readable_page_ids();
