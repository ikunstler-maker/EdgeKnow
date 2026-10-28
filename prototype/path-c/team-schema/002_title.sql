-- A second migration, to check that updates reach every team and run once.
alter table public.notes add column if not exists title text not null default '';
