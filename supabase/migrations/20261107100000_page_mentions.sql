-- People mentioned with a person chip in a page's text show up in their
-- "Вас згадали" list, like comment mentions. Kept up to date whenever the page's
-- content changes: someone removed from the text drops out of the list.
-- Rollback: supabase/rollbacks/20261107100000_page_mentions.down.sql

create table public.page_mentions (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  mentioned_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (page_id, user_id)
);
create index page_mentions_user_idx on public.page_mentions (user_id, created_at desc);

alter table public.page_mentions enable row level security;
revoke all on public.page_mentions from anon;
revoke insert, update, delete, truncate on public.page_mentions from authenticated;

-- Each person sees only their own mentions, and only on pages they can still open.
create policy "People read their own mentions on pages they can see"
  on public.page_mentions for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null);

create function public.refresh_page_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned uuid[];
begin
  -- Ids from person chips anywhere in the document; only people of this
  -- workspace who can see the page, never the author of the change.
  select coalesce(array_agg(distinct m.id), '{}') into mentioned
  from (
    select (value #>> '{}')::uuid as id
    from jsonb_path_query(coalesce(new.content, '[]'::jsonb), 'strict $.** ? (@.type == "personChip").props.userId') value
    where (value #>> '{}') ~ '^[0-9a-f-]{36}$'
  ) m
  where m.id is distinct from auth.uid()
    and public.is_active_member(new.workspace_id, m.id)
    and public.page_role_of(new.id, m.id) is not null;

  delete from public.page_mentions where page_id = new.id and not (user_id = any (mentioned));
  insert into public.page_mentions (workspace_id, page_id, user_id, mentioned_by)
  select new.workspace_id, new.id, u, auth.uid() from unnest(mentioned) u
  on conflict (page_id, user_id) do nothing;
  return new;
end;
$$;

create trigger pages_mentions
  after insert or update of content on public.pages
  for each row execute function public.refresh_page_mentions();

revoke execute on function public.refresh_page_mentions() from public, anon, authenticated;
