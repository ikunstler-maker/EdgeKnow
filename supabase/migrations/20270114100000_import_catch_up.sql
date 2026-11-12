-- Rukh, package 3 (3в): catching up with the tracker while the team moves (only what
-- changed there since the last run), and finding a task by its old key or link.
-- The search function is the same in supabase/team/migrations/0059_import_catch_up.sql; the
-- imports table exists only here.
-- Rollback: supabase/rollbacks/20270114100000_import_catch_up.down.sql

-- When the last run of an import began: the next one asks the tracker only for what changed since.
alter table public.task_imports add column synced_at timestamptz;
update public.task_imports set synced_at = created_at where state = 'done';

-- Finds a task by its key in the tracker it came from ("TMD-123"), or by its key here, in
-- one workspace. Runs with the asker's own rights: a task they may not see is not found.
create function public.find_task_by_key(ws uuid, wanted text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('project_key', p.key, 'number', t.number)
  from public.tasks t join public.task_projects p on p.id = t.project_id
  where t.workspace_id = ws and t.deleted_at is null and char_length(wanted) between 3 and 60
    and (upper(t.external_key) = upper(btrim(wanted)) or p.key || '-' || t.number = upper(btrim(wanted)))
  order by (upper(t.external_key) = upper(btrim(wanted))) desc
  limit 1;
$$;
revoke execute on function public.find_task_by_key(uuid, text) from public, anon;
grant execute on function public.find_task_by_key(uuid, text) to authenticated;
