-- Rukh: links kept with a task next to its files (to a file elsewhere or to a page).
-- The same in supabase/team/migrations/0060_task_web_links.sql.
-- Rollback: supabase/rollbacks/20270115100000_task_web_links.down.sql

-- A link kept with a task next to its files: to a file somewhere else or to a page.
create table public.task_web_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  url           text not null check (char_length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$'),
  added_by      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index task_web_links_task_idx on public.task_web_links (task_id, created_at);
alter table public.task_web_links enable row level security;
revoke all on public.task_web_links from public, anon, authenticated;
grant select on public.task_web_links to authenticated;
-- Seen like the task's files: by those the task is open to.
create policy task_web_links_select on public.task_web_links for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));

-- Whoever may edit the task adds a link to it.
create function public.add_task_web_link(target_task uuid, new_title text, new_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  link_id uuid;
  address text := btrim(coalesce(new_url, ''));
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or public.role_rank(public.task_role(target_task)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(address) > 2000 or address !~* '^https?://[^[:space:]]+$' then
    return public.page_error('invalid_url');
  end if;
  if (select count(*) from public.task_web_links l where l.task_id = target_task) >= 50 then
    return public.page_error('too_many_web_links');
  end if;
  insert into public.task_web_links (workspace_id, task_id, title, url, added_by)
  values (task.workspace_id, target_task, left(coalesce(nullif(btrim(new_title), ''), address), 200), address, auth.uid())
  returning id into link_id;
  return jsonb_build_object('ok', true, 'id', link_id);
end;
$$;
revoke execute on function public.add_task_web_link(uuid, text, text) from public, anon;
grant execute on function public.add_task_web_link(uuid, text, text) to authenticated;

-- …and removes one (or the person who added it).
create function public.delete_task_web_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.task_web_links;
begin
  select * into link from public.task_web_links where id = target_link;
  if link.id is null
     or (public.role_rank(public.task_role(link.task_id)) < public.role_rank('editor')
         and not (link.added_by = auth.uid() and public.task_role(link.task_id) is not null)) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_web_links where id = target_link;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.delete_task_web_link(uuid) from public, anon;
grant execute on function public.delete_task_web_link(uuid) to authenticated;
