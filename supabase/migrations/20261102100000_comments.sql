-- Stage 6: comments on a selected fragment.
--
-- The fragment carries a `comment` style mark with the thread id inside the page
-- document, so it moves with the text. Threads and messages live in their own
-- tables, with their own rights: commenters never write the document themselves;
-- create_marked_comment_thread puts the mark in for them after checking that only
-- the mark changes.
-- Rollback: supabase/rollbacks/20261102100000_comments.down.sql

-------------------------------------------------------------------------------
-- Roles of other people (for @mentions)
-------------------------------------------------------------------------------

-- Role of any person on a page, without the membership check (callers do it).
create function public.page_role_of(target_page uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with chain as (
    select c.* from public.access_chain(target_page) c
  ),
  candidates as (
    select case when c.depth = 0 then 'owner' else 'editor' end as role
    from chain c where c.owner_id = member
    union all
    select c.workspace_role from chain c where c.workspace_role is not null
    union all
    select a.role from chain c join public.page_access a on a.page_id = c.id and a.user_id = member
  )
  select role from candidates order by public.role_rank(role) desc limit 1;
$$;

-- Same result as in stage 5, now built on page_role_of.
create or replace function public.effective_role(target_page uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.page_role_of(p.id, auth.uid())
  from public.pages p
  where p.id = target_page and public.is_workspace_member(p.workspace_id);
$$;

create function public.can_comment_page(target_page uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.effective_role(target_page) in ('owner', 'editor', 'commenter'), false);
$$;

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

create table public.comment_threads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  quoted_text   text not null default '' check (char_length(quoted_text) <= 1000),
  -- orphaned = the commented text was deleted from the page.
  status        text not null default 'open' check (status in ('open', 'resolved', 'orphaned')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  resolved_by   uuid references public.profiles (id) on delete set null,
  resolved_at   timestamptz
);

create index comment_threads_page_idx on public.comment_threads (page_id, created_at);

create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  thread_id     uuid not null references public.comment_threads (id) on delete cascade,
  author_id     uuid references public.profiles (id) on delete set null,
  body          text not null check (char_length(body) between 1 and 5000),
  mentions      uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);

create index comments_thread_idx on public.comments (thread_id, created_at);
create index comments_mentions_idx on public.comments using gin (mentions);

alter table public.comment_threads enable row level security;
alter table public.comments enable row level security;
revoke all on public.comment_threads, public.comments from anon;
revoke insert, update, delete, truncate on public.comment_threads, public.comments from authenticated;

-- Threads live in their page's workspace, messages in their thread's.
create function public.check_thread_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select p.workspace_id from public.pages p where p.id = new.page_id) then
    raise exception 'thread and page must be in the same workspace';
  end if;
  return new;
end;
$$;

create function public.check_comment_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.comment_threads t where t.id = new.thread_id) then
    raise exception 'comment and thread must be in the same workspace';
  end if;
  return new;
end;
$$;

create trigger comment_threads_same_workspace
  before insert or update on public.comment_threads
  for each row execute function public.check_thread_workspace();
create trigger comments_same_workspace
  before insert or update on public.comments
  for each row execute function public.check_comment_workspace();

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- Keeps only people of the workspace who can see the page (and not the author).
create function public.clean_mentions(target_page uuid, mention_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m), '{}')
  from unnest(coalesce(mention_ids, '{}')) m
  join public.pages p on p.id = target_page
  where m <> auth.uid()
    and public.is_active_member(p.workspace_id, m)
    and public.page_role_of(target_page, m) is not null;
$$;

-- Open threads whose mark left the document become orphaned, and come back when
-- it returns (undo, or the editor's save with a new mark arriving later).
create function public.refresh_thread_status(target_page uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.comment_threads t
  set status = x.new_status
  from (
    select t2.id,
           case when position(t2.id::text in coalesce(p.content::text, '')) > 0 then 'open' else 'orphaned' end as new_status
    from public.comment_threads t2
    join public.pages p on p.id = t2.page_id
    where t2.page_id = target_page and t2.status in ('open', 'orphaned')
  ) x
  where t.id = x.id and t.status <> x.new_status;
$$;

-- Adds the comment mark to [start_pos, end_pos) of a block's inline content. Positions
-- count characters (code points) of text, links included. Returns the new nodes, the
-- covered text and the content's length.
create function public.mark_inline(nodes jsonb, start_pos integer, end_pos integer, thread text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := '[]'::jsonb;
  covered text := '';
  pos integer := 0;
  node jsonb;
  piece text;
  len integer;
  s integer;
  e integer;
  inner_result jsonb;
begin
  for node in select value from jsonb_array_elements(coalesce(nodes, '[]'::jsonb)) loop
    if node ->> 'type' = 'text' then
      piece := coalesce(node ->> 'text', '');
      len := char_length(piece);
      s := greatest(start_pos - pos, 0);
      e := least(end_pos - pos, len);
      if s >= e then
        result := result || jsonb_build_array(node);
      else
        if s > 0 then
          result := result || jsonb_build_array(jsonb_set(node, '{text}', to_jsonb(substr(piece, 1, s))));
        end if;
        result := result || jsonb_build_array(
          jsonb_set(
            jsonb_set(node, '{text}', to_jsonb(substr(piece, s + 1, e - s))),
            '{styles}', coalesce(node -> 'styles', '{}'::jsonb) || jsonb_build_object('comment', thread)
          )
        );
        covered := covered || substr(piece, s + 1, e - s);
        if e < len then
          result := result || jsonb_build_array(jsonb_set(node, '{text}', to_jsonb(substr(piece, e + 1))));
        end if;
      end if;
      pos := pos + len;
    elsif node ->> 'type' = 'link' then
      inner_result := public.mark_inline(node -> 'content', start_pos - pos, end_pos - pos, thread);
      result := result || jsonb_build_array(jsonb_set(node, '{content}', inner_result -> 'nodes'));
      covered := covered || (inner_result ->> 'text');
      pos := pos + (inner_result ->> 'length')::integer;
    else
      result := result || jsonb_build_array(node);
    end if;
  end loop;
  return jsonb_build_object('nodes', result, 'text', covered, 'length', pos);
end;
$$;

-- Applies ranges [{block, start, end, text}] to the blocks they name, at any depth.
-- Returns the new blocks, how many ranges matched and the covered text in order.
create function public.mark_blocks(blocks jsonb, ranges jsonb, thread text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := '[]'::jsonb;
  block jsonb;
  r jsonb;
  marked jsonb;
  sub jsonb;
  applied integer := 0;
  mismatch boolean := false;
  texts text[] := '{}';
begin
  for block in select value from jsonb_array_elements(coalesce(blocks, '[]'::jsonb)) loop
    select x into r from jsonb_array_elements(ranges) x where x ->> 'block' = block ->> 'id' limit 1;
    if r is not null and jsonb_typeof(block -> 'content') = 'array' then
      marked := public.mark_inline(block -> 'content', (r ->> 'start')::integer, (r ->> 'end')::integer, thread);
      if (marked ->> 'text') is distinct from (r ->> 'text') or (marked ->> 'text') = '' then
        mismatch := true;
      end if;
      block := jsonb_set(block, '{content}', marked -> 'nodes');
      applied := applied + 1;
      texts := texts || (marked ->> 'text');
    end if;
    if jsonb_typeof(block -> 'children') = 'array' and jsonb_array_length(block -> 'children') > 0 then
      sub := public.mark_blocks(block -> 'children', ranges, thread);
      block := jsonb_set(block, '{children}', sub -> 'blocks');
      applied := applied + (sub ->> 'applied')::integer;
      mismatch := mismatch or (sub ->> 'mismatch')::boolean;
      texts := texts || array(select jsonb_array_elements_text(sub -> 'texts'));
    end if;
    result := result || jsonb_build_array(block);
  end loop;
  return jsonb_build_object('blocks', result, 'applied', applied, 'mismatch', mismatch, 'texts', to_jsonb(texts));
end;
$$;

-------------------------------------------------------------------------------
-- Actions. All return {"ok": true, ...} or {"ok": false, "error": "<code>"}.
-------------------------------------------------------------------------------

-- Owners and editors: the browser adds the mark itself and saves the page as usual.
create function public.create_comment_thread(target_page uuid, quoted text, body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  new_thread uuid;
  new_comment uuid;
  cleaned text := trim(coalesce(body, ''));
begin
  if not public.can_comment_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = target_page and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;

  select workspace_id into ws from public.pages where id = target_page;
  insert into public.comment_threads (workspace_id, page_id, quoted_text, created_by)
  values (ws, target_page, left(trim(coalesce(quoted, '')), 1000), auth.uid())
  returning id into new_thread;
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (ws, new_thread, auth.uid(), cleaned, public.clean_mentions(target_page, mention_ids))
  returning id into new_comment;
  return jsonb_build_object('ok', true, 'id', new_thread, 'comment_id', new_comment);
end;
$$;

-- Commenters (anyone who may comment): the server marks the fragment. Only the mark
-- is written, on the version the person was looking at.
create function public.create_marked_comment_thread(
  target_page uuid,
  base_version integer,
  ranges jsonb,
  body text,
  mention_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current record;
  cleaned text := trim(coalesce(body, ''));
  new_thread uuid := gen_random_uuid();
  marked jsonb;
  quoted text;
begin
  if not public.can_comment_page(target_page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  if jsonb_typeof(ranges) is distinct from 'array' or jsonb_array_length(ranges) not between 1 and 200
     or exists (
       select 1 from jsonb_array_elements(ranges) x
       where jsonb_typeof(x -> 'start') <> 'number' or jsonb_typeof(x -> 'end') <> 'number'
          or (x ->> 'start')::integer < 0 or (x ->> 'end')::integer <= (x ->> 'start')::integer
          or jsonb_typeof(x -> 'block') <> 'string'
     ) then
    return public.page_error('invalid_range');
  end if;

  select p.workspace_id, p.content, p.version, p.deleted_at into current
  from public.pages p where p.id = target_page
  for update;

  if current.deleted_at is not null then
    return public.page_error('in_trash');
  end if;
  if current.version <> base_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', current.version);
  end if;

  marked := public.mark_blocks(current.content, ranges, new_thread::text);
  if (marked ->> 'applied')::integer <> jsonb_array_length(ranges) or (marked ->> 'mismatch')::boolean then
    return public.page_error('invalid_range');
  end if;
  if octet_length((marked -> 'blocks')::text) > public.page_content_limit() then
    return public.page_error('too_large');
  end if;
  quoted := array_to_string(array(select jsonb_array_elements_text(marked -> 'texts')), ' ');

  update public.pages
  set content = marked -> 'blocks', version = current.version + 1, updated_at = now(), updated_by = auth.uid()
  where id = target_page;

  insert into public.comment_threads (id, workspace_id, page_id, quoted_text, created_by)
  values (new_thread, current.workspace_id, target_page, left(quoted, 1000), auth.uid());
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (current.workspace_id, new_thread, auth.uid(), cleaned, public.clean_mentions(target_page, mention_ids));
  return jsonb_build_object('ok', true, 'id', new_thread, 'version', current.version + 1);
end;
$$;

create function public.reply_to_thread(target_thread uuid, body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread public.comment_threads;
  cleaned text := trim(coalesce(body, ''));
  new_comment uuid;
begin
  select * into thread from public.comment_threads where id = target_thread;
  if thread.id is null or not public.can_comment_page(thread.page_id) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.pages where id = thread.page_id and deleted_at is not null) then
    return public.page_error('in_trash');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  insert into public.comments (workspace_id, thread_id, author_id, body, mentions)
  values (thread.workspace_id, thread.id, auth.uid(), cleaned, public.clean_mentions(thread.page_id, mention_ids))
  returning id into new_comment;
  return jsonb_build_object('ok', true, 'id', new_comment);
end;
$$;

-- "Вирішено" hides the highlight and moves the thread to the page's archive.
create function public.set_thread_resolved(target_thread uuid, resolved boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread public.comment_threads;
begin
  select * into thread from public.comment_threads where id = target_thread;
  if thread.id is null or not public.can_comment_page(thread.page_id) then
    return public.page_error('forbidden');
  end if;
  if resolved then
    update public.comment_threads
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where id = target_thread;
  else
    update public.comment_threads
    set status = 'open', resolved_by = null, resolved_at = null
    where id = target_thread;
    perform public.refresh_thread_status(thread.page_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- People edit and delete only their own messages.
create function public.edit_comment(target_comment uuid, body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page uuid;
  cleaned text := trim(coalesce(body, ''));
begin
  select t.page_id into page
  from public.comments c join public.comment_threads t on t.id = c.thread_id
  where c.id = target_comment and c.author_id = auth.uid();
  if page is null or not public.can_comment_page(page) then
    return public.page_error('forbidden');
  end if;
  if char_length(cleaned) not between 1 and 5000 then
    return public.page_error('invalid_comment');
  end if;
  update public.comments
  set body = cleaned, mentions = public.clean_mentions(page, mention_ids), edited_at = now()
  where id = target_comment;
  return jsonb_build_object('ok', true);
end;
$$;

-- Deleting the last message deletes the thread (its mark stays harmlessly in the text).
create function public.delete_comment(target_comment uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread uuid;
  page uuid;
begin
  select c.thread_id, t.page_id into thread, page
  from public.comments c join public.comment_threads t on t.id = c.thread_id
  where c.id = target_comment and c.author_id = auth.uid();
  if thread is null or public.effective_role(page) is null then
    return public.page_error('forbidden');
  end if;
  delete from public.comments where id = target_comment;
  if not exists (select 1 from public.comments where thread_id = thread) then
    delete from public.comment_threads where id = thread;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Who can be @mentioned on a page: members who can see it.
create function public.mention_candidates(target_page uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if public.effective_role(target_page) is null then
    return public.page_error('forbidden');
  end if;
  select workspace_id into ws from public.pages where id = target_page;
  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', pr.id, 'name', pr.name, 'email', pr.email)
             order by pr.name nulls last, pr.email)
    from public.workspace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = ws and m.status = 'active' and m.user_id <> auth.uid()
      and public.page_role_of(target_page, m.user_id) is not null
  ), '[]'::jsonb));
end;
$$;

-------------------------------------------------------------------------------
-- Saving the page also refreshes which threads lost their fragment.
-------------------------------------------------------------------------------

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

  perform public.refresh_thread_status(target_page);
  return jsonb_build_object('ok', true, 'version', current.version + 1);
end;
$$;

-------------------------------------------------------------------------------
-- Function permissions
-------------------------------------------------------------------------------

revoke execute on function
  public.page_role_of(uuid, uuid),
  public.can_comment_page(uuid),
  public.check_thread_workspace(),
  public.check_comment_workspace(),
  public.clean_mentions(uuid, uuid[]),
  public.refresh_thread_status(uuid),
  public.mark_inline(jsonb, integer, integer, text),
  public.mark_blocks(jsonb, jsonb, text),
  public.create_comment_thread(uuid, text, text, uuid[]),
  public.create_marked_comment_thread(uuid, integer, jsonb, text, uuid[]),
  public.reply_to_thread(uuid, text, uuid[]),
  public.set_thread_resolved(uuid, boolean),
  public.edit_comment(uuid, text, uuid[]),
  public.delete_comment(uuid),
  public.mention_candidates(uuid)
from public, anon, authenticated;

grant execute on function
  public.create_comment_thread(uuid, text, text, uuid[]),
  public.create_marked_comment_thread(uuid, integer, jsonb, text, uuid[]),
  public.reply_to_thread(uuid, text, uuid[]),
  public.set_thread_resolved(uuid, boolean),
  public.edit_comment(uuid, text, uuid[]),
  public.delete_comment(uuid),
  public.mention_candidates(uuid)
to authenticated;

-------------------------------------------------------------------------------
-- RLS: comments are visible to whoever can see the page.
-------------------------------------------------------------------------------

create policy "Members read threads of pages they can see"
  on public.comment_threads for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);

create policy "Members read comments of pages they can see"
  on public.comments for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.comment_threads t
      where t.id = thread_id and public.effective_role(t.page_id) is not null
    )
  );
