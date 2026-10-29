-- Undo 20261117100000_rate_limits.sql (only counters are lost).
drop function if exists public.hit_rate_limit(text, integer, integer);
drop table if exists public.rate_limits;
