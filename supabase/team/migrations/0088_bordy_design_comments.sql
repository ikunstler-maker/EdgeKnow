-- BORDY-1 in a team's own database (as supabase/migrations/20270214100000_bordy_design_comments.sql).
-- Rollback: supabase/team/rollbacks/0088_bordy_design_comments.down.sql
--
-- BORDY-1: comments pinned on a "Design" canvas (owner's approval 2026-11-13). Who sees the
-- file sees its comments; commenters, editors and owners write; the author edits or deletes
-- their own; the file's editors and owners resolve threads and delete any.

create table public.design_comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  object_id    uuid not null references public.service_objects (id) on delete cascade,
  page_id      text not null check (char_length(page_id) between 1 and 80),
  parent_id    uuid references public.design_comments (id) on delete cascade,
  x            double precision not null default 0,
  y            double precision not null default 0,
  node_id      text check (node_id is null or char_length(node_id) <= 120),
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  author_id    uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null
);
create index design_comments_object_idx on public.design_comments (object_id, created_at);
alter table public.design_comments enable row level security;

create policy "Who sees a design file sees its comments"
  on public.design_comments for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and public.my_object_role(object_id) is not null);

revoke all on public.design_comments from public, anon, authenticated;
grant select on public.design_comments to authenticated;

-- A new pin (or a reply in its thread). Commenters and up, on a "Design" file not in the bin.
create function public.add_design_comment(target uuid, page text, at_x double precision, at_y double precision, node text, text_body text, reply_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  file public.service_objects;
  thread public.design_comments;
  made uuid;
begin
  select * into file from public.service_objects o where o.id = target and o.deleted_at is null;
  if not found or file.service <> 'boards' or file.kind <> 'design' or not public.is_workspace_member(file.workspace_id) then
    return public.page_error('not_found');
  end if;
  if public.role_rank(coalesce(public.service_object_role(file.id), '')) < public.role_rank('commenter') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(text_body, ''))) not between 1 and 4000 then
    return public.page_error('invalid');
  end if;
  if reply_to is not null then
    select * into thread from public.design_comments c where c.id = reply_to and c.object_id = file.id and c.parent_id is null;
    if not found then
      return public.page_error('not_found');
    end if;
  end if;
  insert into public.design_comments (workspace_id, object_id, page_id, parent_id, x, y, node_id, body, author_id)
  values (file.workspace_id, file.id, coalesce(thread.page_id, left(coalesce(page, ''), 80)), reply_to,
          coalesce(thread.x, at_x, 0), coalesce(thread.y, at_y, 0), case when reply_to is null then left(node, 120) end, btrim(text_body), auth.uid())
  returning id into made;
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

-- Resolve or reopen a thread: the file's editors and owners, or who started it.
create function public.resolve_design_comment(target uuid, resolved boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.design_comments;
begin
  select * into c from public.design_comments x where x.id = target and x.parent_id is null;
  if not found or not public.is_workspace_member(c.workspace_id) or public.service_object_role(c.object_id) is null then
    return public.page_error('not_found');
  end if;
  if c.author_id is distinct from auth.uid() and public.role_rank(public.service_object_role(c.object_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.design_comments set resolved_at = case when resolved then now() end, resolved_by = case when resolved then auth.uid() end where id = c.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Delete a comment (a thread goes with its replies): its author, or the file's editors and owners.
create function public.delete_design_comment(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.design_comments;
begin
  select * into c from public.design_comments x where x.id = target;
  if not found or not public.is_workspace_member(c.workspace_id) or public.service_object_role(c.object_id) is null then
    return public.page_error('not_found');
  end if;
  if c.author_id is distinct from auth.uid() and public.role_rank(public.service_object_role(c.object_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  delete from public.design_comments where id = c.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.add_design_comment(uuid, text, double precision, double precision, text, text, uuid),
  public.resolve_design_comment(uuid, boolean), public.delete_design_comment(uuid) from public, anon;
grant execute on function public.add_design_comment(uuid, text, double precision, double precision, text, text, uuid),
  public.resolve_design_comment(uuid, boolean), public.delete_design_comment(uuid) to authenticated;
