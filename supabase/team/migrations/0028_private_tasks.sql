-- Private tasks in a team's own database (as supabase/migrations/20261212100000_private_tasks.sql).
-- Rollback: supabase/team/rollbacks/0028_private_tasks.down.sql

-- Private tasks: seen only by their author, assignee and participants (co-assignees,
-- responsible), and by the workspace's owner and admins only if the workspace allows it.
alter table public.tasks add column private boolean not null default false;

create table public.task_participants (
  task_id       uuid not null references public.tasks (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('co_assignee', 'responsible')),
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_participants_user_idx on public.task_participants (user_id);
alter table public.task_participants enable row level security;
revoke all on public.task_participants from public, anon, authenticated;
grant select on public.task_participants to authenticated;

create function public.check_task_participant_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select t.workspace_id from public.tasks t where t.id = new.task_id) is distinct from new.workspace_id then
    raise exception 'participant outside the task''s workspace';
  end if;
  return new;
end;
$$;
create trigger task_participants_same_workspace before insert or update on public.task_participants
  for each row execute function public.check_task_participant_workspace();

alter table public.team_settings add column private_tasks_admin boolean not null default false;

create function public.admins_see_private_tasks(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.private_tasks_admin from public.team_settings s), false);
$$;

-- Whether this person may see this task at all (the project's own rules come on top).
create function public.task_visible_to(target uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target
      and (not t.private
           or person in (t.reporter_id, t.assignee_id)
           or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = person)
           or (public.admins_see_private_tasks(t.workspace_id)
               and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = person
                           and m.status = 'active' and m.role in ('owner', 'admin')))));
$$;

-- For row rules: whether the signed-in person may see this task.
create function public.task_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.task_visible_to(target, auth.uid());
$$;

-- The person's role on one task: the project's role, or nothing for a private task they don't see.
create function public.task_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, auth.uid())
              then public.task_project_role((select t.project_id from public.tasks t where t.id = target)) end;
$$;

create function public.task_role_of(target uuid, person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_visible_to(target, person)
              then public.task_project_role_of((select t.project_id from public.tasks t where t.id = target), person) end;
$$;

create policy "People see the participants of tasks open to them"
  on public.task_participants for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);

drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null
         and (not private or public.task_visible(id)));
drop policy "Members see comments on tasks open to them" on public.task_comments;
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see the history of tasks open to them" on public.task_events;
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see links of tasks open to them" on public.task_links;
create policy "Members see links of tasks open to them"
  on public.task_links for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and (public.task_role(source_id) is not null or public.task_role(target_id) is not null));
drop policy "Members see files of tasks open to them" on public.task_files;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_role(task_id) is not null);
drop policy "Members see mentions on pages and of tasks open to them" on public.task_page_links;
create policy "Members see mentions on pages and of tasks open to them"
  on public.task_page_links for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.effective_role(page_id) is not null
         and public.task_role(task_id) is not null);

-- The author makes a task private or publishes it to the project.
create function public.set_task_private(target uuid, make_private boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tasks t where t.id = target and t.reporter_id = auth.uid() and t.deleted_at is null)
     or public.task_role(target) is null then
    return public.page_error('forbidden');
  end if;
  update public.tasks set private = coalesce(make_private, false), updated_at = now(), updated_by = auth.uid() where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

-- Co-assignees and the responsible: whoever may edit the task sets them (all at once).
create function public.set_task_participants(target uuid, people jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select t.workspace_id from public.tasks t where t.id = target);
begin
  if public.role_rank(public.task_role(target)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if jsonb_typeof(coalesce(people, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(people, '[]'::jsonb)) > 30
     or exists (select 1 from jsonb_array_elements(coalesce(people, '[]'::jsonb)) e
                where coalesce(e ->> 'role', '') not in ('co_assignee', 'responsible')
                   or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.status = 'active'
                                  and m.user_id::text = e ->> 'user_id')) then
    return public.page_error('invalid');
  end if;
  delete from public.task_participants where task_id = target;
  insert into public.task_participants (task_id, workspace_id, user_id, role, added_by)
  select distinct on ((e ->> 'user_id')::uuid) target, ws, (e ->> 'user_id')::uuid, e ->> 'role', auth.uid()
  from jsonb_array_elements(coalesce(people, '[]'::jsonb)) e;
  return jsonb_build_object('ok', true);
end;
$$;

-- For the workspace's owner and admins: private tasks of a project they don't see,
-- with their key and the people on them, never their contents.
create function public.private_task_people(target_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'key', p.key || '-' || t.number, 'status_id', t.status_id,
           'people', (select jsonb_agg(distinct x) from (
              select t.reporter_id as x union select t.assignee_id union
              select pp.user_id from public.task_participants pp where pp.task_id = t.id) s where x is not null))
         order by t.number), '[]'::jsonb)
  from public.tasks t join public.task_projects p on p.id = t.project_id
  where t.project_id = target_project and t.private and t.deleted_at is null
    and public.task_project_role(target_project) is not null
    and not public.task_visible_to(t.id, auth.uid())
    and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = auth.uid()
                and m.status = 'active' and m.role in ('owner', 'admin'));
$$;

-- Every check on one task now asks about that task, not only its project.
create or replace function public.update_task(target_task uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  problem text;
  new_status uuid;
  done boolean;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  problem := public.task_fields_valid(task.project_id, changes);
  if problem is not null then
    return public.page_error(problem);
  end if;
  problem := public.task_custom_valid(task.project_id, changes -> 'custom');
  if problem is not null then
    return public.page_error(problem);
  end if;
  -- A task can't be its own parent, nor a parent of one of its parents.
  if (changes ->> 'parent_id') is not null and exists (
    with recursive up (id, depth) as (
      select (changes ->> 'parent_id')::uuid, 1
      union all
      select t.parent_id, up.depth + 1 from public.tasks t join up on t.id = up.id
      where t.parent_id is not null and up.depth < 100
    )
    select 1 from up where up.id = target_task
  ) then
    return public.page_error('invalid_parent');
  end if;
  new_status := case when changes ? 'status_id' then (changes ->> 'status_id')::uuid else task.status_id end;
  done := (select s.category = 'done' from public.task_statuses s where s.id = new_status);
  update public.tasks set
    title = case when changes ? 'title' then btrim(changes ->> 'title') else title end,
    description = case when changes ? 'description' then changes -> 'description' else description end,
    status_id = new_status,
    type = coalesce(changes ->> 'type', type),
    priority = coalesce(changes ->> 'priority', priority),
    assignee_id = case when changes ? 'assignee_id' then (changes ->> 'assignee_id')::uuid else assignee_id end,
    labels = case when changes ? 'labels' then coalesce((select array_agg(l) from jsonb_array_elements_text(changes -> 'labels') l), '{}') else labels end,
    start_date = case when changes ? 'start_date' then (changes ->> 'start_date')::date else start_date end,
    due_date = case when changes ? 'due_date' then (changes ->> 'due_date')::date else due_date end,
    estimate = case when changes ? 'estimate' then (changes ->> 'estimate')::numeric else estimate end,
    parent_id = case when changes ? 'parent_id' then (changes ->> 'parent_id')::uuid else parent_id end,
    position = coalesce((changes ->> 'position')::double precision, position),
    -- Own fields merge: a value replaces, null clears.
    custom = case when changes ? 'custom' then jsonb_strip_nulls(custom || (changes -> 'custom')) else custom end,
    done_at = case when done and done_at is null then now() when not done then null else done_at end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_task;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_task_comment(target_task uuid, body text, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  new_id uuid;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_role(task.id)) < public.role_rank('commenter') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(body, ''))) not between 1 and 10000 then
    return public.page_error('invalid');
  end if;
  insert into public.task_comments (workspace_id, task_id, author_id, body, mentions)
  values (task.workspace_id, target_task, auth.uid(), btrim(body),
    coalesce((select array_agg(distinct m) from unnest(mention_ids) m where public.is_active_member(task.workspace_id, m)), '{}'))
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.edit_task_comment(target_comment uuid, new_body text, remove boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comment public.task_comments;
  project uuid;
begin
  select * into comment from public.task_comments where id = target_comment;
  if not found then
    return public.page_error('not_found');
  end if;
  project := (select t.project_id from public.tasks t where t.id = comment.task_id);
  if public.task_role(comment.task_id) is null
     or (comment.author_id is distinct from auth.uid() and (not remove or public.task_role(comment.task_id) <> 'owner')) then
    return public.page_error('forbidden');
  end if;
  if remove then
    delete from public.task_comments where id = target_comment;
    return jsonb_build_object('ok', true);
  end if;
  if char_length(btrim(coalesce(new_body, ''))) not between 1 and 10000 then
    return public.page_error('invalid');
  end if;
  update public.task_comments set body = btrim(new_body), edited_at = now() where id = target_comment;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_task(target_task uuid, restore boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
begin
  select * into task from public.tasks where id = target_task;
  if not found or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  update public.tasks
  set deleted_at = case when restore then null else now() end,
      deleted_by = case when restore then null else auth.uid() end,
      updated_at = now(), updated_by = auth.uid()
  where id = target_task;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_task_link(source_task uuid, target_task uuid, link_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.tasks;
  target public.tasks;
  new_id uuid;
begin
  select * into source from public.tasks where id = source_task;
  if not found or source.deleted_at is not null or public.role_rank(public.task_role(source.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  select * into target from public.tasks where id = target_task;
  if not found or target.deleted_at is not null or target.workspace_id <> source.workspace_id
     or public.task_role(target.id) is null then
    return public.page_error('task_not_found');
  end if;
  if link_kind not in ('blocks', 'relates', 'duplicates') or source_task = target_task then
    return public.page_error('invalid');
  end if;
  if exists (select 1 from public.task_links l where least(l.source_id, l.target_id) = least(source_task, target_task)
             and greatest(l.source_id, l.target_id) = greatest(source_task, target_task) and l.kind = link_kind) then
    return public.page_error('link_exists');
  end if;
  if (select count(*) from public.task_links l where l.source_id = source_task or l.target_id = source_task) >= 100 then
    return public.page_error('too_many_links');
  end if;
  insert into public.task_links (workspace_id, source_id, target_id, kind, created_by)
  values (source.workspace_id, source_task, target_task, link_kind, auth.uid())
  returning id into new_id;
  insert into public.task_events (workspace_id, task_id, actor_id, field, new_value)
  values (source.workspace_id, source_task, auth.uid(), 'link', jsonb_build_object('kind', link_kind, 'task', target_task)),
         (source.workspace_id, target_task, auth.uid(), 'link', jsonb_build_object('kind', link_kind, 'task', source_task));
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.delete_task_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.task_links;
begin
  select * into link from public.task_links where id = target_link;
  if not found or greatest(
    public.role_rank(public.task_role(link.source_id)),
    public.role_rank(public.task_role(link.target_id))
  ) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  delete from public.task_links where id = target_link;
  insert into public.task_events (workspace_id, task_id, actor_id, field, old_value)
  values (link.workspace_id, link.source_id, auth.uid(), 'unlink', jsonb_build_object('kind', link.kind, 'task', link.target_id)),
         (link.workspace_id, link.target_id, auth.uid(), 'unlink', jsonb_build_object('kind', link.kind, 'task', link.source_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.register_task_file(target_task uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  project public.task_projects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or public.role_rank(public.task_role(task.id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.task_files f where f.task_id = target_task) >= 100 then
    return public.page_error('too_many_files');
  end if;
  select * into project from public.task_projects where id = task.project_id;
  path := task.workspace_id || '/tasks/' || target_task || '/' || new_id;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, task.workspace_id, target_task, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'target', project.files_target,
                            'workspace_id', task.workspace_id, 'project_id', project.id);
end;
$$;

create or replace function public.delete_task_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  file public.task_files;
  role text;
begin
  select * into file from public.task_files where id = target_file;
  if not found then
    return public.page_error('forbidden');
  end if;
  role := public.task_role(file.task_id);
  if role is null or (public.role_rank(role) < public.role_rank('editor') and file.uploaded_by is distinct from auth.uid()) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_files where id = target_file;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.my_notifications(ws uuid, max_rows integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.workspace_id = ws and n.user_id = auth.uid() and n.read_at is null),
    'items', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select n.id, n.kind, n.created_at, n.read_at,
             coalesce(a.name, a.email) as actor,
             case when t.id is not null and public.task_role(t.id) is not null
                  then jsonb_build_object('id', t.id, 'key', p.key || '-' || t.number, 'number', t.number, 'project', p.key, 'title', t.title, 'status', s.name) end as task,
             case when g.id is not null and public.page_role_of(g.id, auth.uid()) is not null
                  then jsonb_build_object('id', g.id, 'title', g.title) end as page
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;

create or replace function public.notify_person(ws uuid, person uuid, what text, actor uuid, about_task uuid, about_page uuid, about_status uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only what a signed-in person does notifies anyone (copies between databases, admin tools: nobody).
  if auth.uid() is null or person is null or person = actor then
    return;
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = person and m.status = 'active') then
    return;
  end if;
  if about_task is not null and public.task_role_of(about_task, person) is null then
    return;
  end if;
  if about_page is not null and public.page_role_of(about_page, person) is null then
    return;
  end if;
  if exists (select 1 from public.notification_prefs p where p.workspace_id = ws and p.user_id = person and what = any (p.muted)) then
    return;
  end if;
  -- The same thing twice within a minute is one notification.
  if exists (select 1 from public.notifications n where n.user_id = person and n.kind = what
             and n.task_id is not distinct from about_task and n.page_id is not distinct from about_page
             and n.created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, task_id, page_id, status_id)
  values (ws, person, what, actor, about_task, about_page, about_status);
end;
$$;

create or replace function public.create_task(target_project uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  problem text;
  status uuid;
  new_id uuid;
  new_number integer;
begin
  if public.role_rank(public.task_project_role(target_project)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  problem := public.task_fields_valid(target_project, fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  problem := public.task_custom_valid(target_project, fields -> 'custom');
  if problem is not null then
    return public.page_error(problem);
  end if;
  update public.task_projects set next_number = next_number + 1
  where id = target_project and archived_at is null
  returning * into project;
  if not found then
    return public.page_error('archived');
  end if;
  new_number := project.next_number - 1;
  status := coalesce((fields ->> 'status_id')::uuid,
    (select s.id from public.task_statuses s where s.project_id = target_project order by
       case s.category when 'todo' then 0 when 'doing' then 1 else 2 end, s.position limit 1));
  insert into public.tasks (workspace_id, project_id, number, title, description, status_id, type, priority,
                            assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, updated_by, custom, private)
  values (
    project.workspace_id, target_project, new_number, btrim(fields ->> 'title'), fields -> 'description', status,
    coalesce(fields ->> 'type', 'task'), coalesce(fields ->> 'priority', 'medium'),
    (fields ->> 'assignee_id')::uuid, auth.uid(),
    coalesce((select array_agg(l) from jsonb_array_elements_text(fields -> 'labels') l), '{}'),
    (fields ->> 'start_date')::date, (fields ->> 'due_date')::date, (fields ->> 'estimate')::numeric,
    (fields ->> 'parent_id')::uuid,
    coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1,
    auth.uid(),
    jsonb_strip_nulls(coalesce(fields -> 'custom', '{}'::jsonb)),
    coalesce((fields ->> 'private')::boolean, false)
  )
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'key', project.key || '-' || new_number, 'number', new_number);
end;
$$;

create or replace function public.team_sync(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws jsonb := payload -> 'workspace';
  ws_id uuid := (ws ->> 'id')::uuid;
begin
  if ws_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if exists (select 1 from public.workspaces w where w.id <> ws_id) then
    -- A team database belongs to exactly one workspace.
    return jsonb_build_object('ok', false, 'error', 'other_workspace');
  end if;

  insert into public.profiles (id, email, name, avatar_url)
  select (p ->> 'id')::uuid, p ->> 'email', p ->> 'name', p ->> 'avatar_url'
  from jsonb_array_elements(coalesce(payload -> 'profiles', '[]')) p
  on conflict (id) do update set email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url;

  insert into public.workspaces (id, short_id, name, owner_id, created_by, storage_limit_mb, created_at)
  values (ws_id, ws ->> 'short_id', ws ->> 'name', (ws ->> 'owner_id')::uuid, (ws ->> 'owner_id')::uuid,
          coalesce((ws ->> 'storage_limit_mb')::integer, 50), coalesce((ws ->> 'created_at')::timestamptz, now()))
  on conflict (id) do update set short_id = excluded.short_id, name = excluded.name,
    owner_id = excluded.owner_id, storage_limit_mb = excluded.storage_limit_mb;

  if payload ? 'members' then
    -- The owner changes hands without two owners at once.
    update public.workspace_members m set role = 'admin'
    where m.workspace_id = ws_id and m.role = 'owner'
      and m.user_id is distinct from (ws ->> 'owner_id')::uuid;
    insert into public.workspace_members (workspace_id, user_id, role, joined_via, status, joined_at, profile_visibility, access_until)
    select ws_id, (m ->> 'user_id')::uuid, m ->> 'role', coalesce(m ->> 'joined_via', 'invite'), 'active',
           coalesce((m ->> 'joined_at')::timestamptz, now()), coalesce(m ->> 'profile_visibility', 'private'),
           (m ->> 'access_until')::timestamptz
    from jsonb_array_elements(payload -> 'members') m
    on conflict (workspace_id, user_id) do update set role = excluded.role, joined_via = excluded.joined_via,
      status = 'active', profile_visibility = excluded.profile_visibility, access_until = excluded.access_until;
    update public.workspace_members m set status = 'removed'
    where m.workspace_id = ws_id and m.status = 'active'
      and not exists (select 1 from jsonb_array_elements(payload -> 'members') x where (x ->> 'user_id')::uuid = m.user_id);
  end if;

  -- Guests own nothing here: what they made passes to the workspace owner.
  if payload ? 'members' then
    perform public.hand_guest_content_to_owner(ws_id, m.user_id)
    from public.workspace_members m
    where m.workspace_id = ws_id and m.status = 'active' and m.role = 'guest'
      and (exists (select 1 from public.pages p where p.workspace_id = ws_id and p.owner_id = m.user_id)
        or exists (select 1 from public.service_objects o where o.workspace_id = ws_id and o.owner_id = m.user_id));
  end if;

  if payload ? 'groups' then
    -- Groups as they are centrally; a group gone there takes its page grants here with it.
    delete from public.workspace_groups g
    where g.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(payload -> 'groups') x where (x ->> 'id')::uuid = g.id);
    insert into public.workspace_groups (id, workspace_id, name, created_at)
    select (x ->> 'id')::uuid, ws_id, x ->> 'name', coalesce((x ->> 'created_at')::timestamptz, now())
    from jsonb_array_elements(payload -> 'groups') x
    on conflict (id) do update set name = excluded.name;
    delete from public.workspace_group_members gm
    where gm.workspace_id = ws_id
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'group_members', '[]')) x
                      where (x ->> 'group_id')::uuid = gm.group_id and (x ->> 'user_id')::uuid = gm.user_id);
    insert into public.workspace_group_members (group_id, workspace_id, user_id)
    select (x ->> 'group_id')::uuid, ws_id, (x ->> 'user_id')::uuid
    from jsonb_array_elements(coalesce(payload -> 'group_members', '[]')) x
    on conflict (group_id, user_id) do nothing;
  end if;

  update public.team_settings set
    workspace_id = ws_id,
    issuer = coalesce(payload -> 'settings' ->> 'issuer', issuer),
    files_on_drive = coalesce((payload -> 'settings' ->> 'files_on_drive')::boolean, files_on_drive),
    private_tasks_admin = coalesce((payload -> 'settings' ->> 'private_tasks_admin')::boolean, private_tasks_admin),
    updated_at = now()
  -- Supabase refuses an UPDATE without WHERE coming through its API.
  where id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.check_task_participant_workspace(), public.admins_see_private_tasks(uuid),
  public.task_visible_to(uuid, uuid), public.task_role_of(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.task_visible(uuid), public.task_role(uuid), public.set_task_private(uuid, boolean),
  public.set_task_participants(uuid, jsonb), public.private_task_people(uuid) from public, anon;
grant execute on function public.task_visible(uuid), public.task_role(uuid), public.set_task_private(uuid, boolean),
  public.set_task_participants(uuid, jsonb), public.private_task_people(uuid) to authenticated;
