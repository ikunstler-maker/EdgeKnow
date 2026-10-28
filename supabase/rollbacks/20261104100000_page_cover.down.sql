-- Undo 20261104100000_page_cover.sql. Covers are lost; uploaded cover images are
-- collected as unused by the next clean-up.
create or replace function public.collect_unreferenced_attachments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.attachments a
  using public.pages p
  where p.id = a.page_id
    and a.created_at < now() - interval '1 day'
    and position(a.storage_path in coalesce(p.content::text, '')) = 0;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
drop function if exists public.set_page_cover(uuid, jsonb);
drop function if exists public.clean_cover(jsonb, uuid);
alter table public.pages drop column if exists cover;
