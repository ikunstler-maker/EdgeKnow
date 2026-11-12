-- Rukh, access rights one to one (Д-2): permissions for comments, attachments and time, and
-- what a person may do on the board before a task is open.
-- The same in supabase/migrations/20270120100000_task_permissions_more.sql.
-- Rollback: supabase/team/rollbacks/0065_task_permissions_more.down.sql

-- More actions for a project's permissions: comments, attachments and time, each with "one's
-- own" apart from "anyone's" where the tracker has it so.
alter table public.task_permissions drop constraint task_permissions_action_check;
alter table public.task_permissions add constraint task_permissions_action_check check (action in ('create', 'edit', 'delete', 'assign', 'be_assigned', 'schedule', 'transition', 'link',
    'comment_add', 'comment_edit_own', 'comment_edit_any', 'comment_delete_own', 'comment_delete_any',
    'file_add', 'file_delete_own', 'file_delete_any', 'time_log', 'time_edit_own', 'time_edit_any'));

-- The usual rule of an action: the lowest role that may do it when the project has no row
-- of its own for it ("owner": only the project's owners).
create function public.task_action_usual(wanted text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when wanted in ('be_assigned', 'comment_edit_own', 'comment_delete_own', 'file_delete_own', 'time_edit_own') then 'viewer'
    when wanted = 'comment_add' then 'commenter'
    when wanted in ('comment_edit_any', 'comment_delete_any', 'time_edit_any') then 'owner'
    else 'editor'
  end;
$$;
revoke execute on function public.task_action_usual(text) from public, anon;
grant execute on function public.task_action_usual(text) to authenticated;

create or replace function public.task_action_allowed(target_project uuid, wanted text, task public.tasks, person uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  role text := public.task_project_role_of(target_project, person);
  rule public.task_permissions;
begin
  if role is null then
    return false;
  end if;
  if role = 'owner' then
    return true;
  end if;
  select * into rule from public.task_permissions p where p.project_id = target_project and p.action = wanted;
  if rule.project_id is null then
    return public.role_rank(role) >= public.role_rank(public.task_action_usual(wanted));
  end if;
  return role = any (rule.roles)
      or person = any (rule.members)
      or exists (select 1 from unnest(rule.groups) g where public.unit_reaches(g, person))
      or (rule.reporter and coalesce(task.reporter_id = person, false))
      or (rule.assignee and coalesce(task.assignee_id = person, false));
end;
$$;

create or replace function public.task_permits(target_task uuid, wanted text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  seen text := public.task_role(target_task);
begin
  select * into task from public.tasks where id = target_task;
  if task.id is null or seen is null then
    return false;
  end if;
  if seen is distinct from public.task_project_role(task.project_id) then
    return public.role_rank(seen) >= public.role_rank(public.task_action_usual(wanted));
  end if;
  return public.task_action_allowed(task.project_id, wanted, task, auth.uid());
end;
$$;

create or replace function public.my_task_permissions(target_task uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(a, public.task_permits(target_task, a)) from unnest(array['create', 'edit', 'delete', 'assign', 'be_assigned', 'schedule', 'transition', 'link',
    'comment_add', 'comment_edit_own', 'comment_edit_any', 'comment_delete_own', 'comment_delete_any',
    'file_add', 'file_delete_own', 'file_delete_any', 'time_log', 'time_edit_own', 'time_edit_any']) a where a <> 'be_assigned';
$$;

create or replace function public.set_task_permission(target_project uuid, wanted text, holders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  new_roles text[];
  new_groups uuid[];
  new_members uuid[];
begin
  if ws is null or coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if coalesce(wanted, '') not in ('create', 'edit', 'delete', 'assign', 'be_assigned', 'schedule', 'transition', 'link',
    'comment_add', 'comment_edit_own', 'comment_edit_any', 'comment_delete_own', 'comment_delete_any',
    'file_add', 'file_delete_own', 'file_delete_any', 'time_log', 'time_edit_own', 'time_edit_any') then
    return public.page_error('invalid');
  end if;
  if holders is null or jsonb_typeof(holders) = 'null' then
    delete from public.task_permissions where project_id = target_project and action = wanted;
    return jsonb_build_object('ok', true);
  end if;
  begin
    new_roles := coalesce((select array_agg(distinct v) from jsonb_array_elements_text(coalesce(holders -> 'roles', '[]'::jsonb)) v), '{}');
    new_groups := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(coalesce(holders -> 'groups', '[]'::jsonb)) v), '{}');
    new_members := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(coalesce(holders -> 'members', '[]'::jsonb)) v), '{}');
  exception when others then
    return public.page_error('invalid');
  end;
  if not (new_roles <@ array['editor', 'commenter', 'viewer']) or cardinality(new_groups) > 50 or cardinality(new_members) > 50
     or exists (select 1 from unnest(new_groups) g where not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = ws))
     or exists (select 1 from unnest(new_members) m where not public.is_active_member(ws, m)) then
    return public.page_error('invalid');
  end if;
  insert into public.task_permissions (project_id, workspace_id, action, roles, groups, members, reporter, assignee, updated_by)
  values (target_project, ws, wanted, new_roles, new_groups, new_members,
          coalesce((holders ->> 'reporter')::boolean, false), coalesce((holders ->> 'assignee')::boolean, false), auth.uid())
  on conflict (project_id, action) do update set roles = excluded.roles, groups = excluded.groups, members = excluded.members,
    reporter = excluded.reporter, assignee = excluded.assignee, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- What the asker may do in a project before any task is open: make tasks, and whether
-- moving them can be theirs at all (by role, unit or name — or as a task's author or assignee).
create function public.my_project_permissions(target_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.task_project_role(target_project) is null then null else jsonb_build_object(
    'create', public.project_permits(target_project, 'create'),
    'transition', public.project_permits(target_project, 'transition')
                  or exists (select 1 from public.task_permissions p where p.project_id = target_project and p.action = 'transition' and (p.reporter or p.assignee))) end;
$$;
revoke execute on function public.my_project_permissions(uuid) from public, anon;
grant execute on function public.my_project_permissions(uuid) to authenticated;

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
  if not found or task.deleted_at is not null or not public.task_permits(task.id, 'comment_add') then
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
     or not public.task_permits(comment.task_id,
          case when comment.author_id = auth.uid() then (case when remove then 'comment_delete_own' else 'comment_edit_own' end)
               else (case when remove then 'comment_delete_any' else 'comment_edit_any' end) end) then
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
  if not found or task.deleted_at is not null or not public.task_permits(task.id, 'file_add') then
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

create or replace function public.begin_large_task_file(target_task uuid, file_name text, file_type text, file_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  project public.task_projects;
  new_id uuid := gen_random_uuid();
  mime text := lower(coalesce(file_type, ''));
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or not public.task_permits(task.id, 'file_add') then
    return public.page_error('forbidden');
  end if;
  select * into project from public.task_projects where id = task.project_id;
  if mime !~ '^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$' then
    mime := 'application/octet-stream';
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes < 1 then
    return public.page_error('invalid_file');
  end if;
  if file_bytes > (case when mime = 'application/zip' then project.zip_limit_mb else project.file_limit_mb end)::bigint * 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.task_files f where f.task_id = target_task) >= 100 then
    return public.page_error('too_many_files');
  end if;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by, large)
  values (new_id, task.workspace_id, target_task, btrim(file_name), mime, file_bytes, task.workspace_id || '/tasks/' || target_task || '/' || new_id, auth.uid(), true);
  return jsonb_build_object('ok', true, 'id', new_id, 'workspace_id', task.workspace_id);
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
  if role is null or not public.task_permits(file.task_id, case when file.uploaded_by = auth.uid() then 'file_delete_own' else 'file_delete_any' end) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_files where id = target_file;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_task_time(target_task uuid, target_entry uuid, spent_minutes integer, spent_date date, new_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  entry public.task_time_entries;
  entry_id uuid;
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or public.task_role(target_task) is null or (target_entry is null and not public.task_permits(target_task, 'time_log'))
     or not coalesce((select p.time_tracking from public.task_projects p where p.id = task.project_id), false) then
    return public.page_error('forbidden');
  end if;
  if spent_minutes is null or spent_minutes not between 1 and 100000 or spent_date is null
     or spent_date > current_date + 1 or spent_date < current_date - 3650 or char_length(coalesce(new_note, '')) > 500 then
    return public.page_error('invalid');
  end if;
  if target_entry is null then
    insert into public.task_time_entries (workspace_id, task_id, user_id, minutes, spent_on, note)
    values (task.workspace_id, target_task, auth.uid(), spent_minutes, spent_date, nullif(btrim(coalesce(new_note, '')), ''))
    returning id into entry_id;
    return jsonb_build_object('ok', true, 'id', entry_id);
  end if;
  select * into entry from public.task_time_entries where id = target_entry and task_id = target_task;
  -- One's own entry, or any entry for the project's owner.
  if entry.id is null or not public.task_permits(target_task, case when entry.user_id = auth.uid() then 'time_edit_own' else 'time_edit_any' end) then
    return public.page_error('forbidden');
  end if;
  update public.task_time_entries set minutes = spent_minutes, spent_on = spent_date, note = nullif(btrim(coalesce(new_note, '')), ''), updated_at = now()
  where id = target_entry;
  return jsonb_build_object('ok', true, 'id', target_entry);
end;
$$;

create or replace function public.delete_task_time(target_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.task_time_entries;
begin
  select * into entry from public.task_time_entries where id = target_entry;
  if entry.id is null or not public.task_permits(entry.task_id, case when entry.user_id = auth.uid() then 'time_edit_own' else 'time_edit_any' end) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_time_entries where id = target_entry;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_task_web_link(target_task uuid, new_title text, new_url text)
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
  if task.id is null or not public.task_permits(target_task, 'file_add') then
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

create or replace function public.delete_task_web_link(target_link uuid)
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
     or not public.task_permits(link.task_id, case when link.added_by = auth.uid() then 'file_delete_own' else 'file_delete_any' end) then
    return public.page_error('forbidden');
  end if;
  delete from public.task_web_links where id = target_link;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_task_recurrence(target_task uuid, rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  n integer;
  u text;
  days smallint[];
  first date;
  last date;
begin
  select * into task from public.tasks where id = target_task and deleted_at is null;
  if task.id is null or not public.task_permits(target_task, 'edit') then
    return public.page_error('forbidden');
  end if;
  if rule is null or jsonb_typeof(rule) = 'null' then
    delete from public.task_recurrences where task_id = target_task;
    return jsonb_build_object('ok', true);
  end if;
  begin
    n := (rule ->> 'every')::integer;
    u := rule ->> 'unit';
    days := coalesce((select array_agg(distinct v::smallint order by v::smallint) from jsonb_array_elements_text(coalesce(rule -> 'weekdays', '[]'::jsonb)) v), '{}');
    first := coalesce((rule ->> 'start')::date, current_date + 1);
    last := (rule ->> 'until')::date;
  exception when others then
    return public.page_error('invalid');
  end;
  if n is null or n not between 1 and 366 or coalesce(u, '') not in ('day', 'week', 'month', 'year') or not (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
     or first < current_date or first > current_date + 3660 or (last is not null and last < first) then
    return public.page_error('invalid');
  end if;
  if u <> 'week' then
    days := '{}';
  end if;
  -- The first date falls on a chosen weekday.
  if cardinality(days) > 0 and not (extract(isodow from first)::smallint = any (days)) then
    first := public.recurrence_after(first, 1, 'week', days);
  end if;
  insert into public.task_recurrences (workspace_id, task_id, every_n, unit, weekdays, next_on, until, created_by)
  values (task.workspace_id, target_task, n, u, days, first, last, auth.uid())
  on conflict (task_id) do update set every_n = excluded.every_n, unit = excluded.unit, weekdays = excluded.weekdays,
    next_on = excluded.next_on, until = excluded.until;
  return jsonb_build_object('ok', true, 'next_on', first);
end;
$$;
