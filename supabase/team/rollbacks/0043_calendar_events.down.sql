-- Undo 0043_calendar_events.
drop function public.purge_calendar_events();
drop function public.calendar_busy(uuid, uuid[], timestamptz, timestamptz);
drop function public.calendar_event_details(uuid);
drop function public.calendar_events_in(uuid, timestamptz, timestamptz);
drop function public.set_calendar_settings(uuid, smallint[], text);
drop function public.cancel_calendar_event(uuid, boolean);
drop function public.decide_calendar_event_request(uuid, uuid, boolean);
drop function public.respond_to_calendar_event(uuid, text);
drop function public.remove_calendar_event_attendee(uuid, uuid);
drop function public.invite_to_calendar_event(uuid, uuid[]);
drop function public.update_calendar_event(uuid, jsonb);
drop function public.create_calendar_event(uuid, jsonb, uuid[]);
drop function public.calendar_event_problem(jsonb);
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
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due']::text[] then
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
drop function public.notify_event(uuid, uuid, text, uuid, uuid);
-- Notifications about events go with the events.
delete from public.notifications where kind in ('event_invite', 'event_request', 'event_answer', 'event_change');
update public.notification_prefs set muted = array(select m from unnest(muted) m where m not like 'event_%') where muted && array['event_invite', 'event_request', 'event_answer', 'event_change'];
drop index public.notifications_event_idx;
alter table public.notifications
  drop constraint notifications_kind_check,
  drop column event_id,
  add constraint notifications_kind_check check (kind in ('mention', 'assigned', 'comment', 'rule', 'due'));
drop table public.calendar_settings;
drop table public.calendar_event_attendees;
drop table public.calendar_events;
drop function public.can_cancel_calendar_event(uuid);
drop function public.calendar_event_visible(uuid);
drop function public.calendar_event_visible_to(uuid, uuid);
