-- Node space, step Н2 (diagrams): what search reads from an object.
-- The same in supabase/team/migrations/0014_object_text.sql.
-- Rollback: supabase/rollbacks/20261128100000_object_text.down.sql

-- The text of an object for search: mind map nodes' text, and in a diagram the
-- boxes' titles and descriptions and the arrows' labels.
create or replace function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from (
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.edges[*].label') value
  ) parts
  where value #>> '{}' <> '';
$$;
revoke execute on function public.service_object_text(jsonb) from public, anon;

-- Diagrams saved before this change get their text now.
update public.service_objects set search_text = public.service_object_text(data) where kind = 'flow';
