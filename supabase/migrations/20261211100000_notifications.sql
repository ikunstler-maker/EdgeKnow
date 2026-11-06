-- Tasks and notifications (packages 7 and 8): a «review» column type, per-person notifications
-- (mentions, assignment, comments, due dates, project rules) and per-workspace settings.
-- Rollback: supabase/rollbacks/20261211100000_notifications.down.sql

-- 1. A fourth column type: «Перевіряють» (review).
alter table public.task_statuses drop constraint task_statuses_category_check;
alter table public.task_statuses add constraint task_statuses_category_check check (category in ('todo', 'doing', 'review', 'done'));

-- 2. Notifications: one row per recipient. Only ids are kept; what is shown is read
-- at display time, so someone who lost access sees nothing of the task or page.
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('mention', 'assigned', 'comment', 'rule', 'due')),
  actor_id      uuid references public.profiles (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete cascade,
  page_id       uuid references public.pages (id) on delete cascade,
  status_id     uuid references public.task_statuses (id) on delete set null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
create policy "People see their own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));

-- What each person wants to hear about in a workspace (kinds switched off).
create table public.notification_prefs (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  muted         text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from public, anon, authenticated;
grant select on public.notification_prefs to authenticated;
create policy "People see their own notification settings"
  on public.notification_prefs for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));

-- 3. A project's rules: when something happens to a task, tell these people.
create table public.task_rules (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  project_id     uuid not null references public.task_projects (id) on delete cascade,
  event          text not null check (event in ('enter_category', 'enter_status', 'assigned', 'comment', 'due_changed')),
  category       text check (category in ('todo', 'doing', 'review', 'done')),
  status_id      uuid references public.task_statuses (id) on delete cascade,
  notify_roles   text[] not null default '{}',
  notify_users   uuid[] not null default '{}',
  notify_groups  uuid[] not null default '{}',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((event = 'enter_category') = (category is not null)),
  check ((event = 'enter_status') = (status_id is not null)),
  check (notify_roles <@ array['assignee', 'reporter', 'owner']::text[])
);
create index task_rules_project_idx on public.task_rules (project_id);
alter table public.task_rules enable row level security;
revoke all on public.task_rules from public, anon, authenticated;
grant select on public.task_rules to authenticated;
create policy "Members see the rules of projects open to them"
  on public.task_rules for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.task_project_role(project_id) is not null);

create function public.check_task_rule_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select p.workspace_id from public.task_projects p where p.id = new.project_id) is distinct from new.workspace_id
     or (new.status_id is not null and (select s.project_id from public.task_statuses s where s.id = new.status_id) is distinct from new.project_id) then
    raise exception 'task rule outside its project';
  end if;
  return new;
end;
$$;
create trigger task_rules_same_workspace before insert or update on public.task_rules
  for each row execute function public.check_task_rule_workspace();

-- Adds a notification for one person, if they still see the task (or page) and want this kind.
create function public.notify_person(ws uuid, person uuid, what text, actor uuid, about_task uuid, about_page uuid, about_status uuid)
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

-- Everyone a rule names for this task.
create function public.notify_rule(rule public.task_rules, task public.tasks, what text, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
begin
  for person in
    select unnest(rule.notify_users)
    union select m.user_id from public.workspace_group_members m where m.group_id = any (rule.notify_groups)
    union select task.assignee_id where 'assignee' = any (rule.notify_roles)
    union select task.reporter_id where 'reporter' = any (rule.notify_roles)
    union select a.user_id from public.task_project_access a where a.project_id = task.project_id and a.role = 'owner' and 'owner' = any (rule.notify_roles)
    union select p.created_by from public.task_projects p where p.id = task.project_id and 'owner' = any (rule.notify_roles)
  loop
    perform public.notify_person(task.workspace_id, person, what, actor, task.id, null, task.status_id);
  end loop;
end;
$$;

create function public.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.task_rules;
  cat text;
  actor uuid := auth.uid();
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    cat := (select s.category from public.task_statuses s where s.id = new.status_id);
    for rule in select * from public.task_rules r where r.project_id = new.project_id
                  and ((r.event = 'enter_status' and r.status_id = new.status_id) or (r.event = 'enter_category' and r.category = cat)) loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'assigned', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'assigned' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
    perform public.notify_person(new.workspace_id, new.assignee_id, 'due', actor, new.id, null, null);
    for rule in select * from public.task_rules r where r.project_id = new.project_id and r.event = 'due_changed' loop
      perform public.notify_rule(rule, new, 'rule', actor);
    end loop;
  end if;
  return new;
end;
$$;
create trigger tasks_notify after insert or update of status_id, assignee_id, due_date on public.tasks
  for each row execute function public.notify_task_change();

create function public.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  rule public.task_rules;
  person uuid;
begin
  select * into task from public.tasks t where t.id = new.task_id;
  foreach person in array new.mentions loop
    perform public.notify_person(new.workspace_id, person, 'mention', new.author_id, new.task_id, null, null);
  end loop;
  -- The assignee hears about comments on their task.
  if not task.assignee_id = any (new.mentions) then
    perform public.notify_person(new.workspace_id, task.assignee_id, 'comment', new.author_id, new.task_id, null, null);
  end if;
  for rule in select * from public.task_rules r where r.project_id = task.project_id and r.event = 'comment' loop
    perform public.notify_rule(rule, task, 'rule', new.author_id);
  end loop;
  return new;
end;
$$;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function public.notify_task_comment();

create function public.notify_page_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_person(new.workspace_id, new.user_id, 'mention', new.mentioned_by, null, new.page_id, null);
  return new;
end;
$$;
create trigger page_mentions_notify after insert on public.page_mentions
  for each row execute function public.notify_page_mention();

-- The notification list, with what the person may still see.
create function public.my_notifications(ws uuid, max_rows integer)
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

create function public.mark_notifications_read(ws uuid, ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n set read_at = now()
  where n.workspace_id = ws and n.user_id = auth.uid() and n.read_at is null and (ids is null or n.id = any (ids));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_notification_prefs(ws uuid, new_muted text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Rules: the project owner adds and removes them.
create function public.save_task_rule(target_project uuid, rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select p.workspace_id from public.task_projects p where p.id = target_project);
  saved uuid;
  users uuid[];
  groups uuid[];
  roles text[];
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if (select count(*) from public.task_rules r where r.project_id = target_project) >= 30 then
    return public.page_error('too_many');
  end if;
  begin
    users := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(rule -> 'users') v), '{}');
    groups := coalesce((select array_agg(distinct v::uuid) from jsonb_array_elements_text(rule -> 'groups') v), '{}');
    roles := coalesce((select array_agg(distinct v) from jsonb_array_elements_text(rule -> 'roles') v), '{}');
  exception when others then
    return public.page_error('invalid');
  end;
  if cardinality(users) + cardinality(groups) + cardinality(roles) = 0 or cardinality(users) > 50
     or exists (select 1 from unnest(users) u where not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = u and m.status = 'active'))
     or exists (select 1 from unnest(groups) g where not exists (select 1 from public.workspace_groups x where x.id = g and x.workspace_id = ws)) then
    return public.page_error('invalid');
  end if;
  begin
    insert into public.task_rules (workspace_id, project_id, event, category, status_id, notify_roles, notify_users, notify_groups, created_by)
    values (ws, target_project, rule ->> 'event', nullif(rule ->> 'category', ''), nullif(rule ->> 'status_id', '')::uuid, roles, users, groups, auth.uid())
    returning id into saved;
  exception when others then
    return public.page_error('invalid');
  end;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

create function public.delete_task_rule(target_rule uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.task_project_role((select r.project_id from public.task_rules r where r.id = target_rule)), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  delete from public.task_rules where id = target_rule;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.check_task_rule_workspace(), public.notify_person(uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.notify_rule(public.task_rules, public.tasks, text, uuid), public.notify_task_change(),
  public.notify_task_comment(), public.notify_page_mention(),
  public.my_notifications(uuid, integer), public.mark_notifications_read(uuid, uuid[]),
  public.set_notification_prefs(uuid, text[]), public.save_task_rule(uuid, jsonb), public.delete_task_rule(uuid)
from public, anon, authenticated;
grant execute on function
  public.my_notifications(uuid, integer), public.mark_notifications_read(uuid, uuid[]),
  public.set_notification_prefs(uuid, text[]), public.save_task_rule(uuid, jsonb), public.delete_task_rule(uuid)
to authenticated;

-- Columns of the new type can be saved.
create or replace function public.save_task_status(target_project uuid, target_status uuid, new_name text, new_category text, new_wip_limit integer, new_position double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  saved uuid;
begin
  if coalesce(public.task_project_role(target_project), '') <> 'owner' then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 40 then
    return public.page_error('invalid_name');
  end if;
  if new_category not in ('todo', 'doing', 'review', 'done') or (new_wip_limit is not null and new_wip_limit not between 1 and 999) then
    return public.page_error('invalid');
  end if;
  ws := (select p.workspace_id from public.task_projects p where p.id = target_project);
  if target_status is null then
    if (select count(*) from public.task_statuses s where s.project_id = target_project) >= 20 then
      return public.page_error('too_many_columns');
    end if;
    insert into public.task_statuses (project_id, workspace_id, name, category, wip_limit, position)
    values (target_project, ws, btrim(new_name), new_category, new_wip_limit,
            coalesce(new_position, (select max(s.position) from public.task_statuses s where s.project_id = target_project) + 1, 1))
    returning id into saved;
  else
    update public.task_statuses
    set name = btrim(new_name), category = new_category, wip_limit = new_wip_limit, position = coalesce(new_position, position)
    where id = target_status and project_id = target_project
    returning id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;
