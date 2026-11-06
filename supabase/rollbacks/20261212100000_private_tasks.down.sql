-- Undo 20261212100000_private_tasks.sql.

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
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
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
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('commenter') then
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
  if public.task_project_role(project) is null
     or (comment.author_id is distinct from auth.uid() and (not remove or public.task_project_role(project) <> 'owner')) then
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
  if not found or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
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
  if not found or source.deleted_at is not null or public.role_rank(public.task_project_role(source.project_id)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  select * into target from public.tasks where id = target_task;
  if not found or target.deleted_at is not null or target.workspace_id <> source.workspace_id
     or public.task_project_role(target.project_id) is null then
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
    public.role_rank(public.task_project_role((select t.project_id from public.tasks t where t.id = link.source_id))),
    public.role_rank(public.task_project_role((select t.project_id from public.tasks t where t.id = link.target_id)))
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
  if not found or task.deleted_at is not null or public.role_rank(public.task_project_role(task.project_id)) < public.role_rank('editor') then
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
  -- EdgeKnow's storage has the workspace's limit (wiki images and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = task.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = task.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = task.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
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
  role := public.task_project_role((select t.project_id from public.tasks t where t.id = file.task_id));
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
             case when t.id is not null and public.task_project_role(t.project_id) is not null
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
  if about_task is not null and public.task_project_role_of((select t.project_id from public.tasks t where t.id = about_task), person) is null then
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
                            assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, updated_by, custom)
  values (
    project.workspace_id, target_project, new_number, btrim(fields ->> 'title'), fields -> 'description', status,
    coalesce(fields ->> 'type', 'task'), coalesce(fields ->> 'priority', 'medium'),
    (fields ->> 'assignee_id')::uuid, auth.uid(),
    coalesce((select array_agg(l) from jsonb_array_elements_text(fields -> 'labels') l), '{}'),
    (fields ->> 'start_date')::date, (fields ->> 'due_date')::date, (fields ->> 'estimate')::numeric,
    (fields ->> 'parent_id')::uuid,
    coalesce((select max(t.position) from public.tasks t where t.status_id = status), 0) + 1,
    auth.uid(),
    jsonb_strip_nulls(coalesce(fields -> 'custom', '{}'::jsonb))
  )
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'key', project.key || '-' || new_number, 'number', new_number);
end;
$$;

create or replace function public.team_sync_payload(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.user_id, m.role, m.joined_via, m.joined_at, m.profile_visibility, m.access_until
    from public.workspace_members m
    where m.workspace_id = ws and m.status = 'active'
      and (m.joined_via <> 'domain' or exists (
        select 1 from public.workspace_domains d join public.profiles p on p.id = m.user_id
        where d.workspace_id = ws and d.is_active and d.domain = public.email_domain(p.email)
      ))
  )
  select jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'short_id', w.short_id, 'name', w.name, 'owner_id', w.owner_id,
                                            'storage_limit_mb', w.storage_limit_mb, 'created_at', w.created_at)
                  from public.workspaces w where w.id = ws),
    'settings', jsonb_build_object('files_on_drive', exists (
      select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok')),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url) order by p.id)
                          from public.profiles p where p.id in (select user_id from members)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'joined_via', m.joined_via,
                                                             'joined_at', m.joined_at, 'profile_visibility', m.profile_visibility,
                                                             'access_until', m.access_until) order by m.user_id)
                         from members m), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'created_at', g.created_at) order by g.id)
                        from public.workspace_groups g where g.workspace_id = ws), '[]'),
    'group_members', coalesce((select jsonb_agg(jsonb_build_object('group_id', gm.group_id, 'user_id', gm.user_id) order by gm.group_id, gm.user_id)
                               from public.workspace_group_members gm
                               where gm.workspace_id = ws and gm.user_id in (select user_id from members)), '[]')
  )
  where exists (select 1 from public.workspaces w where w.id = ws);
$$;
drop policy "Members see mentions on pages and of tasks open to them" on public.task_page_links;
create policy "Members see mentions on pages and of tasks open to them"
  on public.task_page_links for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.effective_role(page_id) is not null
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);
drop policy "Members see files of tasks open to them" on public.task_files;
create policy "Members see files of tasks open to them"
  on public.task_files for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);
drop policy "Members see links of tasks open to them" on public.task_links;
create policy "Members see links of tasks open to them"
  on public.task_links for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and (public.task_project_role((select t.project_id from public.tasks t where t.id = source_id)) is not null
              or public.task_project_role((select t.project_id from public.tasks t where t.id = target_id)) is not null));
drop policy "Members see the history of tasks open to them" on public.task_events;
create policy "Members see the history of tasks open to them"
  on public.task_events for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);
drop policy "Members see comments on tasks open to them" on public.task_comments;
create policy "Members see comments on tasks open to them"
  on public.task_comments for select to authenticated
  using (public.is_workspace_member(workspace_id)
         and public.task_project_role((select t.project_id from public.tasks t where t.id = task_id)) is not null);
drop policy "Members see the tasks of projects open to them" on public.tasks;
create policy "Members see the tasks of projects open to them"
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);
drop function public.set_private_tasks_admin(uuid, boolean);
drop function public.private_task_people(uuid);
drop function public.set_task_participants(uuid, jsonb);
drop function public.set_task_private(uuid, boolean);
drop policy "People see the participants of tasks open to them" on public.task_participants;
drop function public.task_role_of(uuid, uuid);
drop function public.task_role(uuid);
drop function public.task_visible(uuid);
drop function public.task_visible_to(uuid, uuid);
drop function public.admins_see_private_tasks(uuid);
drop trigger task_participants_same_workspace on public.task_participants;
drop function public.check_task_participant_workspace();
drop table public.task_participants;
alter table public.tasks drop column private;
alter table public.workspaces drop column private_tasks_admin;
