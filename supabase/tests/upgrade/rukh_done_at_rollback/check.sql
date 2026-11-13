-- After RUKH-2 and its rollback: the rule is gone, the corrected dates stay.
\pset format unaligned
\pset tuples_only on
select 'trigger gone: ' || not exists (select 1 from pg_trigger where tgname = 'tasks_done_at');
select 'function gone: ' || (to_regprocedure('public.task_done_at()') is null);
select title || ': ' || coalesce(to_char(done_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'no date') from public.tasks where title in ('Board done', 'Reopened') order by title;
