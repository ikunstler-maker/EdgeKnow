-- A wishlist linked to a task, in a team's own database (as supabase/migrations/20270204100000_prof_task_wishlists.sql).
-- Rollback: supabase/team/rollbacks/0077_prof_task_wishlists.down.sql

-- A task can carry colleagues' wishlists (profile, step 4): only the link is kept; the card
-- is read with the viewer's own access to the wishlist.
create table public.task_wishlist_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  wishlist_id  uuid not null references public.service_objects (id) on delete cascade,
  added_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (task_id, wishlist_id)
);
create index task_wishlist_links_task_idx on public.task_wishlist_links (task_id, created_at);

create function public.check_task_wishlist_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select t.workspace_id from public.tasks t where t.id = new.task_id)
     or new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.wishlist_id and o.service = 'wishlists') then
    raise exception 'task and wishlist must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger task_wishlist_links_same_workspace before insert or update on public.task_wishlist_links
  for each row execute function public.check_task_wishlist_link();

alter table public.task_wishlist_links enable row level security;
revoke all on public.task_wishlist_links from public, anon, authenticated;
grant select on public.task_wishlist_links to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.task_wishlist_links to service_role;
  end if;
end $$;
-- Seen like the task's files: by those the task is open to (the card itself checks the wishlist).
create policy task_wishlist_links_select on public.task_wishlist_links for select to authenticated
  using (public.is_workspace_member(workspace_id) and created_at <= public.task_read_until(task_id));

-- Whoever may add files to the task links a wishlist they can see themselves.
create function public.add_task_wishlist_link(target_task uuid, target_wishlist uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  link_id uuid;
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or not public.task_permits(target_task, 'file_add') then
    return public.page_error('forbidden');
  end if;
  if public.service_object_role(target_wishlist) is null
     or not exists (select 1 from public.service_objects o where o.id = target_wishlist and o.service = 'wishlists' and o.workspace_id = task.workspace_id) then
    return public.page_error('invalid');
  end if;
  if (select count(*) from public.task_wishlist_links l where l.task_id = target_task) >= 20 then
    return public.page_error('too_many');
  end if;
  insert into public.task_wishlist_links (workspace_id, task_id, wishlist_id, added_by)
  values (task.workspace_id, target_task, target_wishlist, auth.uid())
  on conflict (task_id, wishlist_id) do nothing
  returning id into link_id;
  return jsonb_build_object('ok', true, 'id', link_id);
end;
$$;

create function public.delete_task_wishlist_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.task_wishlist_links;
begin
  select * into link from public.task_wishlist_links where id = target_link;
  if link.id is null
     or not public.task_permits(link.task_id, case when link.added_by = auth.uid() then 'file_delete_own' else 'file_delete_any' end) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_wishlist_links where id = target_link;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.check_task_wishlist_link() from public, anon, authenticated;
revoke execute on function public.add_task_wishlist_link(uuid, uuid), public.delete_task_wishlist_link(uuid) from public, anon;
grant execute on function public.add_task_wishlist_link(uuid, uuid), public.delete_task_wishlist_link(uuid) to authenticated;
