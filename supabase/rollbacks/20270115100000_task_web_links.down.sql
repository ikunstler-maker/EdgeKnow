-- Undo 20270115100000_task_web_links (the links are removed).
drop function public.delete_task_web_link(uuid);
drop function public.add_task_web_link(uuid, text, text);
drop table public.task_web_links;
