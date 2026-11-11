-- Undo 0053_task_import.
drop function public.set_task_project_key(uuid, text);
drop function public.make_room_for_import(uuid, integer);
drop function public.import_task_relations(uuid, jsonb);
drop function public.import_tasks(uuid, jsonb);
drop trigger tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of status_id, assignee_id, due_date on public.tasks
  for each row execute function public.notify_task_change();
drop trigger tasks_history on public.tasks;
create trigger tasks_history after insert or update on public.tasks
  for each row execute function public.record_task_events();
drop index public.tasks_external_lookup_idx;
drop index public.tasks_external_key_idx;
alter table public.tasks
  drop column imported_assignee,
  drop column imported_reporter,
  drop column external_url,
  drop column external_key;
