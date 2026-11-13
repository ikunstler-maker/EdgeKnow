-- Undo 20270208100000_rukh_done_at. The corrected dates stay (they match the columns).
drop trigger tasks_done_at on public.tasks;
drop function public.task_done_at();
