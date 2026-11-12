-- Undo 0056_imported_private_owner.
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
