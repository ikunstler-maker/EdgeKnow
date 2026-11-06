-- Undo 20261215100000_task_templates.sql.

drop function public.delete_task_template(uuid);
drop function public.save_task_template(uuid, uuid, boolean, text, jsonb, boolean);
drop trigger task_templates_same_workspace on public.task_templates;
drop table public.task_templates;
