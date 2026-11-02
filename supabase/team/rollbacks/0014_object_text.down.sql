-- Back to the text of mind map nodes only.
create or replace function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from jsonb_path_query(coalesce(content, '{}'::jsonb), 'strict $.nodes[*].text') value;
$$;
