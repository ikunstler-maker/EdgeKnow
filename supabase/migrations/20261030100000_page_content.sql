-- Stage 3: saving the editor document with a version check.
--
-- pages.content holds the BlockNote document (a JSON array of blocks) and
-- pages.version counts saves. A save names the version it was based on; if
-- someone saved in between, it is refused with who and when, unless the
-- person chose to overwrite (force).
-- Rollback: supabase/rollbacks/20261030100000_page_content.down.sql

-- About 1 MB of JSON per page (text only; images live in Storage from stage 4).
create function public.page_content_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1000000;
$$;

create function public.save_page_content(
  target_page uuid,
  new_content jsonb,
  base_version integer,
  force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current record;
begin
  if not public.can_edit_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if jsonb_typeof(new_content) is distinct from 'array' then
    return public.page_error('invalid_content');
  end if;
  if octet_length(new_content::text) > public.page_content_limit() then
    return public.page_error('too_large');
  end if;

  -- Lock the row so two simultaneous saves can't both pass the version check.
  select p.version, p.updated_at, p.deleted_at, pr.name as updated_by_name, pr.email as updated_by_email
    into current
  from public.pages p
  left join public.profiles pr on pr.id = p.updated_by
  where p.id = target_page
  for update of p;

  if current.deleted_at is not null then
    return public.page_error('in_trash');
  end if;

  if not force and current.version <> base_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'version', current.version,
      'updated_at', current.updated_at,
      'updated_by', coalesce(current.updated_by_name, current.updated_by_email)
    );
  end if;

  update public.pages
  set content = new_content,
      version = current.version + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_page;

  return jsonb_build_object('ok', true, 'version', current.version + 1);
end;
$$;

revoke execute on function
  public.page_content_limit(),
  public.save_page_content(uuid, jsonb, integer, boolean)
from public, anon, authenticated;
grant execute on function public.save_page_content(uuid, jsonb, integer, boolean) to authenticated;
