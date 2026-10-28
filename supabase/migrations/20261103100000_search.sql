-- Search across pages: titles and text, including diagram nodes and link cards.
--
-- Postgres's built-in full-text search ("simple" configuration: no Ukrainian
-- stemming), with prefix matching so "дизайн" also finds "дизайнер". Results are
-- limited to the caller's workspace and to pages they can open, and can be
-- narrowed to a branch of the tree and a depth.
-- Rollback: supabase/rollbacks/20261103100000_search.down.sql

-------------------------------------------------------------------------------
-- Searchable text of a page, kept up to date by a trigger
-------------------------------------------------------------------------------

-- All text of a BlockNote document: text nodes at any depth, plus the node
-- titles and descriptions of diagrams and the titles of link cards.
create function public.page_plain_text(doc jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  result text;
  extra text;
begin
  if doc is null or jsonb_typeof(doc) <> 'array' then
    return '';
  end if;
  select coalesce(string_agg(value #>> '{}', ' '), '') into result
  from jsonb_path_query(doc, 'strict $.**.text') value
  where jsonb_typeof(value) = 'string';

  select coalesce(string_agg(concat_ws(' ', b -> 'props' ->> 'title', b -> 'props' ->> 'description'), ' '), '')
    into extra
  from jsonb_path_query(doc, 'strict $.** ? (@.type == "linkCard")') b;
  result := result || ' ' || extra;

  -- Diagram data is a JSON string inside the block; a broken one is just skipped.
  begin
    select coalesce(string_agg(concat_ws(' ', n ->> 'title', n ->> 'description'), ' '), '')
      into extra
    from jsonb_path_query(doc, 'strict $.** ? (@.type == "diagram")') b,
         jsonb_array_elements(coalesce(nullif(b -> 'props' ->> 'data', '')::jsonb -> 'nodes', '[]'::jsonb)) n;
    result := result || ' ' || extra;
  exception when others then
    null;
  end;

  return left(regexp_replace(result, '\s+', ' ', 'g'), 200000);
end;
$$;

alter table public.pages
  add column search_text text not null default '',
  add column search_vector tsvector not null default ''::tsvector;

create function public.update_page_search()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := public.page_plain_text(new.content);
  new.search_vector :=
    setweight(to_tsvector('simple'::regconfig, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple'::regconfig, new.search_text), 'B');
  return new;
end;
$$;

create trigger pages_search
  before insert or update of title, content on public.pages
  for each row execute function public.update_page_search();

-- Existing pages.
update public.pages set title = title;

create index pages_search_idx on public.pages using gin (search_vector);

-------------------------------------------------------------------------------
-- Search
-------------------------------------------------------------------------------

-- Words of the query as prefixes: "диз макет" -> 'диз':* & 'макет':*
create function public.search_query(raw text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  select case when count(*) = 0 then null else to_tsquery('simple'::regconfig, string_agg(quote_literal(w) || ':*', ' & ')) end
  from (
    select w
    from unnest(regexp_split_to_array(lower(left(coalesce(raw, ''), 200)), '[^[:alnum:]]+')) w
    where w <> ''
    limit 8
  ) words;
$$;

-- root = null: the whole workspace, depth counted from the top level (0 = only
-- top-level pages). root = a page: that page and below, depth counted from it
-- (0 = only that page). max_depth = null: all levels.
-- Snippets mark matches with U+0001 / U+0002, never with HTML.
create function public.search_pages(ws uuid, query text, root uuid default null, max_depth integer default null)
returns table (id uuid, title text, icon text, parent_id uuid, depth integer, snippet text, rank real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q tsquery := public.search_query(query);
begin
  if q is null or not public.is_workspace_member(ws) then
    return;
  end if;
  if root is not null and (
    public.effective_role(root) is null
    or (select p.workspace_id from public.pages p where p.id = root) is distinct from ws
  ) then
    return;
  end if;

  return query
  with recursive tree as (
    select p.id, 0 as depth
    from public.pages p
    where p.workspace_id = ws and p.deleted_at is null
      and (case when root is null then p.parent_id is null else p.id = root end)
    union all
    select c.id, t.depth + 1
    from public.pages c
    join tree t on c.parent_id = t.id
    where c.deleted_at is null and t.depth < 100 and (max_depth is null or t.depth < max_depth)
  )
  select p.id, p.title, p.icon, p.parent_id, t.depth,
         ts_headline('simple'::regconfig, p.search_text, q,
           'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxWords=18, MinWords=6, MaxFragments=1, FragmentDelimiter=" … "'),
         ts_rank(p.search_vector, q)
  from tree t
  join public.pages p on p.id = t.id
  where p.search_vector @@ q
    and public.effective_role(p.id) is not null
  order by ts_rank(p.search_vector, q) desc, p.updated_at desc
  limit 30;
end;
$$;

revoke execute on function
  public.page_plain_text(jsonb),
  public.update_page_search(),
  public.search_query(text),
  public.search_pages(uuid, text, uuid, integer)
from public, anon, authenticated;

grant execute on function public.search_pages(uuid, text, uuid, integer) to authenticated;

-- The search columns are readable like the rest of the page row (RLS on pages
-- already limits rows to pages the caller can open).
