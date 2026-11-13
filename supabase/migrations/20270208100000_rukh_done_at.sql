-- RUKH-2: a task's "done" date follows its column, whatever moves it (decision 2026-11-13).
-- Rollback: supabase/rollbacks/20270208100000_rukh_done_at.down.sql
--
-- Until now only update_task set done_at; moving a task on a board, the status buttons,
-- column rules, removing a column and repeating tasks changed the column but not the date.
-- So finished tasks were missing from analytics, and a task moved back out of "done" kept
-- its date and dropped out of "My tasks".

-- 1. Into a "done" column: the date is set (a date given in the same change — the import
--    from another tracker — is kept); out of one: the date is cleared. Between two "done"
--    columns the date stays.
create function public.task_done_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id then
    return new;
  end if;
  if coalesce((select s.category = 'done' from public.task_statuses s where s.id = new.status_id), false) then
    new.done_at := coalesce(new.done_at, now());
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.task_done_at() from public, anon, authenticated;

create trigger tasks_done_at before insert or update of status_id on public.tasks
  for each row execute function public.task_done_at();

-- 2. Tasks as they are (owner's approval 2026-11-13): in a "done" column without a date —
--    the date of their last change (the closest known); in any other column — no date.
--    Not written into task history, nobody is notified.
select set_config('ek.importing', 'on', false);
update public.tasks t set done_at = coalesce(t.updated_at, t.created_at, now())
  from public.task_statuses s
  where s.id = t.status_id and s.category = 'done' and t.done_at is null;
update public.tasks t set done_at = null
  from public.task_statuses s
  where s.id = t.status_id and s.category <> 'done' and t.done_at is not null;
select set_config('ek.importing', '', false);
