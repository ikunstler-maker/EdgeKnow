-- After RUKH-2: dates follow the columns; a correct date is untouched; no history lines.
\pset format unaligned
\pset tuples_only on
select title || ': ' || coalesce(to_char(done_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'no date') from public.tasks where title in ('Board done', 'Reopened', 'Window done') order by title;
select 'no new history lines: ' || ((select count(*) from public.task_events) = (select n from public.zz_seed_events));
