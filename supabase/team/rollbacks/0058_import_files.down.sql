-- Undo 0058_import_files.
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
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote, 'comments', said);
end;
$$;
drop function public.note_import_gap(uuid, jsonb);
drop function public.import_task_file(uuid, jsonb);
drop table public.task_import_gaps;
-- Records of files that came from the tracker go (the files stay on the Drive): they
-- don't fit the limits of files attached here.
delete from public.task_files where external_id is not null;
drop index public.task_files_uploader_slot_idx;
drop index public.task_files_external_idx;
alter table public.task_files drop constraint task_files_mime_type_check;
alter table public.task_files drop constraint task_files_bytes_check;
alter table public.task_files drop column uploader_slot, drop column external_id;
alter table public.task_files alter column bytes type integer;
alter table public.task_files add constraint task_files_bytes_check check (bytes between 1 and 4194304);
alter table public.task_files add constraint task_files_mime_type_check CHECK ((mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/gif'::text, 'image/webp'::text, 'application/pdf'::text, 'text/plain'::text, 'text/csv'::text, 'application/zip'::text, 'application/msword'::text, 'application/vnd.ms-excel'::text, 'application/vnd.ms-powerpoint'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'::text])));
