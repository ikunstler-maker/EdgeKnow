-- Tasks in the wiki (see supabase/migrations/20261126100000_task_wiki.sql).
-- Rollback: supabase/team/rollbacks/0012_task_wiki.down.sql

-- Which wiki pages mention which task (a task chip in the text): kept up to date
-- whenever a page's content changes, like person mentions. A task shows
-- "mentioned on pages" — only pages the reader can open, only for readers of the task.

create table public.task_page_links (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  page_id       uuid not null references public.pages (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (page_id, task_id)
);
create index task_page_links_task_idx on public.task_page_links (task_id);

alter table public.task_page_links enable row level security;
revoke all on public.task_page_links from public, anon, authenticated;
grant select on public.task_page_links to authenticated;
create policy "Members see mentions on pages and of tasks open to them"
  on public.task_page_links for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.effective_role(page_id) is not null
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);

create function public.refresh_task_page_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned uuid[];
begin
  -- Task ids from task chips anywhere in the document, of tasks in this workspace.
  select coalesce(array_agg(distinct t.id), '{}') into mentioned
  from (
    select (value #>> '{}') as id
    from jsonb_path_query(coalesce(new.content, '[]'::jsonb), 'strict $.** ? (@.type == "taskChip").props.taskId') value
  ) m
  join public.tasks t on t.id::text = m.id and t.workspace_id = new.workspace_id;

  delete from public.task_page_links where page_id = new.id and not (task_id = any (mentioned));
  insert into public.task_page_links (workspace_id, page_id, task_id)
  select new.workspace_id, new.id, u from unnest(mentioned) u
  on conflict (page_id, task_id) do nothing;
  return new;
end;
$$;

create trigger pages_task_links
  after insert or update of content on public.pages
  for each row execute function public.refresh_task_page_links();

revoke execute on function public.refresh_task_page_links() from public, anon, authenticated;
