-- Undo 20261102100000_comments.sql. Threads and messages are lost; comment marks
-- stay in page documents (the editor ignores them without the comment style).
drop function if exists public.mention_candidates(uuid);
drop function if exists public.delete_comment(uuid);
drop function if exists public.edit_comment(uuid, text, uuid[]);
drop function if exists public.set_thread_resolved(uuid, boolean);
drop function if exists public.reply_to_thread(uuid, text, uuid[]);
drop function if exists public.create_marked_comment_thread(uuid, integer, jsonb, text, uuid[]);
drop function if exists public.create_comment_thread(uuid, text, text, uuid[]);

-- save_page_content as in 20261030100000_page_content.sql.
create or replace function public.save_page_content(
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

drop table if exists public.comments;
drop table if exists public.comment_threads;
drop function if exists public.check_comment_workspace();
drop function if exists public.check_thread_workspace();
drop function if exists public.refresh_thread_status(uuid);
drop function if exists public.mark_blocks(jsonb, jsonb, text);
drop function if exists public.mark_inline(jsonb, integer, integer, text);
drop function if exists public.clean_mentions(uuid, uuid[]);
drop function if exists public.can_comment_page(uuid);

-- effective_role as in 20261101100000_page_access.sql.
create or replace function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with chain as (
    select c.*
    from public.pages p
    cross join lateral public.access_chain(p.id) c
    where p.id = target_page and public.is_workspace_member(p.workspace_id)
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = auth.uid()
    union all
    select c.workspace_role from chain c where c.workspace_role is not null
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = auth.uid()
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;
drop function if exists public.page_role_of(uuid, uuid);
