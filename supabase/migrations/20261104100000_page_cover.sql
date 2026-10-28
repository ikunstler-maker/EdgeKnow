-- Page cover: an image (uploaded or by https link), a solid colour or a gradient
-- (linear or radial, 2–4 colour stops) above the title.
--
-- Only the fields listed below survive validation, colours must be #rrggbb and
-- numbers are clamped, so a cover can't smuggle CSS or markup into the page.
-- Rollback: supabase/rollbacks/20261104100000_page_cover.down.sql

alter table public.pages add column cover jsonb;

-- The cleaned cover, or null when it isn't valid.
create function public.clean_cover(raw jsonb, target_page uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  kind text := raw ->> 'type';
  hex constant text := '^#[0-9a-fA-F]{6}$';
  url text;
  page public.pages;
  stops jsonb;
begin
  if jsonb_typeof(raw) is distinct from 'object' then
    return null;
  end if;
  select * into page from public.pages where id = target_page;

  if kind = 'color' then
    if coalesce(raw ->> 'color', '') !~ hex then return null; end if;
    return jsonb_build_object('type', 'color', 'color', lower(raw ->> 'color'));
  end if;

  if kind = 'gradient' then
    if jsonb_typeof(raw -> 'stops') <> 'array' or jsonb_array_length(raw -> 'stops') not between 2 and 4 then
      return null;
    end if;
    if exists (
      select 1 from jsonb_array_elements(raw -> 'stops') s
      where coalesce(s ->> 'color', '') !~ hex or jsonb_typeof(s -> 'at') <> 'number'
    ) then
      return null;
    end if;
    select jsonb_agg(jsonb_build_object(
             'color', lower(s ->> 'color'),
             'at', greatest(0, least(100, round((s ->> 'at')::numeric)))::integer
           ) order by (s ->> 'at')::numeric)
      into stops
    from jsonb_array_elements(raw -> 'stops') s;
    return jsonb_build_object(
      'type', 'gradient',
      'kind', case when raw ->> 'kind' = 'radial' then 'radial' else 'linear' end,
      'angle', case when jsonb_typeof(raw -> 'angle') = 'number'
                    then (round((raw ->> 'angle')::numeric)::integer % 360 + 360) % 360 else 90 end,
      'stops', stops
    );
  end if;

  if kind = 'image' then
    url := coalesce(raw ->> 'url', '');
    if url like 'ek-attachment:%' then
      -- Our own file: it must be a registered upload of this very page.
      if not exists (
        select 1 from public.attachments a
        where a.storage_path = substr(url, length('ek-attachment:') + 1)
          and a.page_id = target_page and a.workspace_id = page.workspace_id
      ) then
        return null;
      end if;
    elsif char_length(url) > 2000 or url !~ '^https://[^\s"''<>()\\]+$' then
      return null;
    end if;
    return jsonb_build_object(
      'type', 'image',
      'url', url,
      'y', case when jsonb_typeof(raw -> 'y') = 'number'
                then greatest(0, least(100, round((raw ->> 'y')::numeric)))::integer else 50 end
    );
  end if;

  return null;
end;
$$;

-- new_cover = null removes the cover. Owners and editors only.
create function public.set_page_cover(target_page uuid, new_cover jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned jsonb;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if new_cover is not null and jsonb_typeof(new_cover) <> 'null' then
    cleaned := public.clean_cover(new_cover, target_page);
    if cleaned is null then
      return public.page_error('invalid_cover');
    end if;
  end if;
  update public.pages
  set cover = cleaned, updated_at = now(), updated_by = auth.uid()
  where id = target_page;
  return jsonb_build_object('ok', true, 'cover', cleaned);
end;
$$;

-- A cover image counts as used, like an image in the text.
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
    and position(a.storage_path in coalesce(p.content::text, '')) = 0
    and position(a.storage_path in coalesce(p.cover::text, '')) = 0;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function
  public.clean_cover(jsonb, uuid),
  public.set_page_cover(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.set_page_cover(uuid, jsonb) to authenticated;
