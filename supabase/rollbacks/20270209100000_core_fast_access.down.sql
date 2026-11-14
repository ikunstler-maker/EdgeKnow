-- Undo 20270209100000_core_fast_access: the per-row rules come back.
drop policy "Members see the objects open to them" on public.service_objects;
create policy "Members see the objects open to them"
  on public.service_objects for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(id) is not null);

drop policy "Members can read pages they have a role on" on public.pages;
create policy "Members can read pages they have a role on"
  on public.pages for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(id) is not null);

drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and public.task_read_until(id) = 'infinity'::timestamptz);

drop function public.my_object_role(uuid);
drop function public.my_page_role(uuid);
drop function public.task_not_frozen_for_me(uuid);
drop function public.task_visible_to_me(uuid);
drop function public.my_task_project_ids(boolean);
drop function public.my_workspace_ids();
