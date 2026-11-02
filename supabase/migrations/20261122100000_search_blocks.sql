-- Search by what is on a page (headings, images, videos, tables, code, quotes,
-- checklists, callouts, diagrams, link cards). The same in
-- supabase/team/migrations/0008_search_blocks.sql.
-- Rollback: supabase/rollbacks/20261122100000_search_blocks.down.sql

-- Search by what is on a page, not only by words: every heading, every image,
-- video, table, code, quote, checklist, callout, diagram or link card, with
-- the block's own text, and optionally only those containing some words.
-- The same rules as search_pages: only pages the caller can open, in one
-- workspace, optionally under one page and to a depth.
create function public.search_blocks(ws uuid, kind text, query text default null, root uuid default null, max_depth integer default null)
returns table (id uuid, title text, icon text, parent_id uuid, depth integer, block_id text, block_type text, block_text text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  types text[] := case kind
    when 'heading' then array['heading', 'subtitle']
    when 'image' then array['image']
    when 'video' then array['youtube', 'video']
    when 'table' then array['table']
    when 'code' then array['codeBlock']
    when 'quote' then array['quote']
    when 'checklist' then array['checkListItem']
    when 'callout' then array['callout']
    when 'diagram' then array['diagram']
    when 'link' then array['linkCard']
  end;
  words text := nullif(btrim(coalesce(query, '')), '');
begin
  if types is null or not public.is_workspace_member(ws) or char_length(coalesce(words, '')) > 200 then
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
  ),
  blocks as (
    select p.id, p.title, p.icon, p.parent_id, t.depth, p.updated_at, b
    from tree t
    join public.pages p on p.id = t.id
    cross join lateral jsonb_path_query(coalesce(p.content, '[]'::jsonb), 'strict $.**') b
    where jsonb_typeof(b) = 'object' and b ? 'id' and (b ->> 'type') = any (types)
      and public.effective_role(p.id) is not null
  ),
  described as (
    select x.*,
      left(btrim(concat_ws(' ',
        nullif(x.b -> 'props' ->> 'name', ''),
        nullif(x.b -> 'props' ->> 'caption', ''),
        nullif(x.b -> 'props' ->> 'title', ''),
        (select string_agg(v #>> '{}', '') from jsonb_path_query(coalesce(x.b -> 'content', '[]'::jsonb), 'strict $.**.text') v),
        -- Links to other sites only (an uploaded file's address says nothing).
        case when (x.b ->> 'type') in ('image', 'youtube', 'linkCard', 'video') and (x.b -> 'props' ->> 'url') ~* '^https?://' then x.b -> 'props' ->> 'url' end
      )), 300) as text
    from blocks x
  )
  select d.id, d.title, d.icon, d.parent_id, d.depth, d.b ->> 'id', d.b ->> 'type', d.text
  from described d
  where words is null or d.text ilike '%' || replace(replace(replace(words, '\', '\\'), '%', '\%'), '_', '\_') || '%' or d.title ilike '%' || replace(replace(replace(words, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by d.updated_at desc, d.id
  limit 100;
end;
$$;
revoke execute on function public.search_blocks(uuid, text, text, uuid, integer) from public, anon;
grant execute on function public.search_blocks(uuid, text, text, uuid, integer) to authenticated;
