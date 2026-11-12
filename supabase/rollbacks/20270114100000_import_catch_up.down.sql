-- Undo 20270114100000_import_catch_up.
drop function public.find_task_by_key(uuid, text);
alter table public.task_imports drop column synced_at;
