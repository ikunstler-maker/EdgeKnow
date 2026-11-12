-- Undo 0061_time_tracking (time entries are removed).
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
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote, 'comments', said);
end;
$$;
drop function public.import_task_time(uuid, jsonb);
drop function public.project_time_report(uuid, date, date);
drop function public.delete_task_time(uuid);
drop function public.save_task_time(uuid, uuid, integer, date, text);
drop function public.set_project_time_tracking(uuid, boolean, text);
drop table public.task_time_entries;
drop function public.sees_task_time(uuid);
alter table public.task_projects drop column time_visibility, drop column time_tracking;
