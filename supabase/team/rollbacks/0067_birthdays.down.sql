-- Undo 0067_birthdays.
drop function public.set_calendar_birthdays(uuid, boolean);
drop function public.set_member_birthday(uuid, uuid, integer, integer, integer);
drop function public.set_my_birthday(uuid, integer, integer, integer, boolean);
drop function public.birthday_problem(integer, integer, integer);
drop function public.my_birthday(uuid);
drop function public.calendar_birthdays(uuid, date, date);
create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  return null;
end;
$$;

create or replace function public.calendar_feed(ws uuid, hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person uuid;
  range_from timestamptz := date_trunc('day', now()) - interval '30 days';
  range_to timestamptz := date_trunc('day', now()) + interval '366 days';
begin
  if hash is null or hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select f.user_id into person from public.calendar_feeds f where f.workspace_id = ws and f.token_hash = hash;
  if person is null or not public.is_active_member(ws, person) then
    return null;
  end if;
  return jsonb_build_object(
    'events', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at, x.id), '[]'::jsonb) from (
        select e.id, o.title, o.location, o.meeting_url, o.starts_at, o.ends_at, e.all_day, e.updated_at,
               case when e.repeat_freq is not null then o.occurrence_date end as occurrence,
               coalesce(mine.status, 'accepted') as status
        from public.calendar_events e
        left join public.calendar_event_attendees mine on mine.event_id = e.id and mine.user_id = person
        cross join lateral public.calendar_event_occurrences(e.id, range_from, range_to) o
        where e.workspace_id = ws and e.deleted_at is null
          and e.starts_at < range_to
          and case when e.repeat_freq is null then e.ends_at > range_from
                   else e.repeat_until is null or e.repeat_until >= (range_from - interval '40 days')::date end
          and case when mine.user_id is null then coalesce(e.organizer_id = person, false)
                   else mine.status in ('invited', 'accepted', 'tentative') end
        order by o.starts_at, e.id
        limit 2000
      ) x),
    'leave', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.start_date, l.id), '[]'::jsonb) from (
        select r.id, p.name, r.start_date, r.end_date, r.updated_at
        from public.leave_requests r
        join public.leave_policies p on p.id = r.policy_id
        where r.workspace_id = ws and r.user_id = person and r.status = 'approved'
          and r.end_date >= (range_from)::date and r.start_date <= (range_to)::date
        order by r.start_date
        limit 200
      ) l));
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
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(n.event_at, e.starts_at), 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
             -- Who and when; the kind of absence stays in the request itself.
             case when l.id is not null and not public.is_guest(ws, auth.uid())
                       and (l.user_id = auth.uid() or l.deputy_id = auth.uid() or public.leave_can_decide(ws, l.user_id, auth.uid()))
                  then jsonb_build_object('id', l.id, 'person', coalesce(lp.name, lp.email), 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status,
                                          'mine', l.user_id = auth.uid(), 'deputy', coalesce(l.deputy_id = auth.uid(), false)) end as leave
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
      left join public.leave_requests l on l.id = n.leave_request_id
      left join public.profiles lp on lp.id = l.user_id
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;

create or replace function public.calendar_remind_me(ws uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  added integer := 0;
begin
  if me is null or not public.is_workspace_member(ws)
     or exists (select 1 from public.notification_prefs p where p.workspace_id = ws and p.user_id = me and 'event_reminder' = any (p.muted)) then
    return 0;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, event_id, event_at)
  select ws, me, 'event_reminder', e.organizer_id, e.id, o.starts_at
  from public.calendar_event_attendees a
  join public.calendar_events e on e.id = a.event_id
  cross join lateral public.calendar_event_occurrences(e.id, now(), now() + e.reminder_minutes * interval '1 minute') o
  where a.user_id = me and a.workspace_id = ws and a.status in ('invited', 'accepted', 'tentative')
    and e.deleted_at is null and e.reminder_minutes is not null
    and e.starts_at <= now() + interval '2 days'
    and (e.repeat_freq is not null or e.ends_at > now())
    and o.starts_at > now() and o.starts_at <= now() + e.reminder_minutes * interval '1 minute'
    and not exists (select 1 from public.notifications n where n.user_id = me and n.kind = 'event_reminder' and n.event_id = e.id and n.event_at = o.starts_at);
  get diagnostics added = row_count;
  return added;
end;
$$;

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
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

delete from public.notifications where kind = 'birthday';
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info'));

drop function public.birthdays_between(uuid, date, date);
drop function public.birthday_visible(uuid, uuid);
drop function public.workspace_today(uuid);
alter table public.calendar_settings drop column show_birthdays;
alter table public.leave_member_settings
  drop constraint leave_member_settings_birthday_check,
  drop column birthday_shown,
  drop column birth_year,
  drop column birth_day,
  drop column birth_month;
