-- Undo 20261229100000_time_off.
create or replace function public.team_move_people(ws uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with ids as (
    select owner_id as id from public.pages where workspace_id = ws
    union select created_by from public.pages where workspace_id = ws
    union select updated_by from public.pages where workspace_id = ws
    union select deleted_by from public.pages where workspace_id = ws
    union select user_id from public.page_access where workspace_id = ws
    union select granted_by from public.page_access where workspace_id = ws
    union select created_by from public.comment_threads where workspace_id = ws
    union select resolved_by from public.comment_threads where workspace_id = ws
    union select author_id from public.comments where workspace_id = ws
    union select uploaded_by from public.attachments where workspace_id = ws
    union select user_id from public.page_mentions where workspace_id = ws
    union select mentioned_by from public.page_mentions where workspace_id = ws
    union select user_id from public.page_contributions where workspace_id = ws
    union select actor_id from public.audit_log where workspace_id = ws
    union select user_id from public.workspace_members where workspace_id = ws
    union select owner_id from public.workspaces where id = ws
    union select reporter_id from public.tasks where workspace_id = ws
    union select assignee_id from public.tasks where workspace_id = ws
    union select updated_by from public.tasks where workspace_id = ws
    union select deleted_by from public.tasks where workspace_id = ws
    union select author_id from public.task_comments where workspace_id = ws
    union select actor_id from public.task_events where workspace_id = ws
    union select user_id from public.task_project_access where workspace_id = ws
    union select created_by from public.task_projects where workspace_id = ws
    union select owner_id from public.service_objects where workspace_id = ws
    union select created_by from public.service_objects where workspace_id = ws
    union select updated_by from public.service_objects where workspace_id = ws
    union select deleted_by from public.service_objects where workspace_id = ws
    union select user_id from public.service_object_access where workspace_id = ws
    union select organizer_id from public.calendar_events where workspace_id = ws
    union select created_by from public.calendar_events where workspace_id = ws
    union select deleted_by from public.calendar_events where workspace_id = ws
    union select user_id from public.calendar_event_attendees where workspace_id = ws
    union select invited_by from public.calendar_event_attendees where workspace_id = ws
    union select updated_by from public.calendar_settings where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
create or replace function public.save_workspace_role(ws uuid, role_id uuid, new_name text, new_permissions jsonb, new_level text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  known text[] := array['create_pages', 'create_projects', 'create_objects', 'manage_collections', 'manage_fields', 'invite', 'manage_structure'];
  clean jsonb;
  saved uuid;
  kind text;
begin
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active') then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'save_role'));
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 60 then
    return public.ws_error('invalid_name');
  end if;
  if new_level is not null and new_level not in ('viewer', 'commenter', 'editor') then
    return public.ws_error('invalid_role');
  end if;
  if jsonb_typeof(coalesce(new_permissions, '{}'::jsonb)) <> 'object' then
    return public.ws_error('invalid_role');
  end if;
  clean := coalesce((select jsonb_object_agg(k, (new_permissions ->> k)::boolean) from unnest(known) k where new_permissions ? k
                     and jsonb_typeof(new_permissions -> k) = 'boolean'), '{}'::jsonb);
  if role_id is null then
    if (select count(*) from public.workspace_roles r where r.workspace_id = ws) >= 50 then
      return public.ws_error('too_many');
    end if;
    insert into public.workspace_roles (workspace_id, name, permissions, content_level, position)
    values (ws, btrim(new_name), clean, new_level, coalesce((select max(r.position) from public.workspace_roles r where r.workspace_id = ws), 1) + 1)
    returning id into saved;
  else
    select r.builtin into kind from public.workspace_roles r where r.id = role_id and r.workspace_id = ws;
    if not found then
      return public.ws_error('not_found');
    end if;
    -- The admin row keeps every right and no ceiling; only its name changes.
    update public.workspace_roles r set
      name = btrim(new_name),
      permissions = case when kind = 'admin' then '{}'::jsonb else clean end,
      content_level = case when kind = 'admin' then null else new_level end
    where r.id = role_id
    returning r.id into saved;
  end if;
  perform public.log_workspace_action(ws, 'role_saved', jsonb_build_object('role', btrim(new_name)));
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;
-- The right goes from the roles that carry it.
update public.workspace_roles set permissions = permissions - 'manage_leave' where permissions ? 'manage_leave';
drop function public.team_absences(uuid, date, date);
drop function public.leave_balance_sheet(uuid, integer);
drop function public.leave_inbox(uuid);
drop function public.my_leave(uuid, integer);
drop function public.leave_unit_overlaps(uuid, uuid, date, date, uuid);
drop function public.cancel_leave_request(uuid);
drop function public.decide_leave_request(uuid, boolean, text);
drop function public.request_leave(uuid, uuid, date, date, text, uuid, text);
drop function public.adjust_leave_balance(uuid, uuid, uuid, integer, numeric, text);
drop function public.accrue_leave_year(uuid, uuid, integer);
drop function public.save_leave_policy(uuid, uuid, jsonb);
drop function public.seed_leave_policies(uuid, jsonb);
drop function public.leave_numbers(uuid, uuid, integer);
drop function public.leave_days(uuid, text, date, date, text);
drop function public.leave_today(uuid);
create or replace function public.set_notification_prefs(ws uuid, new_muted text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
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
                  then jsonb_build_object('id', g.id, 'title', g.title) end as page,
             case when e.id is not null and public.calendar_event_visible(e.id)
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;
drop function public.notify_leave_deciders(text, uuid, uuid);
drop function public.notify_leave(uuid, text, uuid, uuid);
-- Notifications about time off go with it.
delete from public.notifications where kind in ('leave_request', 'leave_decision', 'leave_deputy', 'leave_info');
update public.notification_prefs set muted = array(select m from unnest(muted) m where m not like 'leave_%') where muted && array['leave_request', 'leave_decision', 'leave_deputy', 'leave_info'];
drop index public.notifications_leave_idx;
alter table public.notifications
  drop constraint notifications_kind_check,
  drop column leave_request_id,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change'));
drop table public.leave_requests;
drop table public.leave_balances;
drop table public.leave_policies;
drop function public.can_manage_leave(uuid);
drop function public.leave_visible(uuid, uuid);
drop function public.leave_can_decide(uuid, uuid, uuid);
drop function public.leave_leads_of(uuid, uuid);
drop function public.leave_manager(uuid, uuid);
