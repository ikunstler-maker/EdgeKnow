-- Doba reminders in a team database: calendar_remind_me takes a lock per person first,
-- so two calls at once add nothing twice.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
select 'the lock is taken first: ' || (pg_get_functiondef('public.calendar_remind_me(uuid)'::regprocedure) like '%pg_advisory_xact_lock%');
