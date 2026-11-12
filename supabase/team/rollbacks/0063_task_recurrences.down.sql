-- Undo 0063_task_recurrences (the rules are removed; copies already made stay).
drop trigger tasks_recurrence_done on public.tasks;
drop function public.recurrence_on_done();
drop function public.run_task_recurrences();
drop function public.spawn_task_recurrence(uuid);
drop function public.set_task_recurrence(uuid, jsonb);
drop function public.recurrence_after(date, integer, text, smallint[]);
drop table public.task_recurrences;
