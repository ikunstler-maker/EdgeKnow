-- Undo 0071_remind_once.
create or replace function public.calendar_remind_me(ws uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  added integer := 0;
  born integer := 0;
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
  -- Birthdays of today (the workspace's own day): to the people who share a unit with
  -- the person — or to everyone, when the person is in no unit. Once per person and year.
  if not public.is_guest(ws, me)
     and not exists (select 1 from public.notification_prefs p where p.workspace_id = ws and p.user_id = me and 'birthday' = any (p.muted)) then
    insert into public.notifications (workspace_id, user_id, kind, actor_id, event_at)
    select ws, me, 'birthday', b.user_id, b.day::timestamp at time zone 'UTC'
    from public.birthdays_between(ws, public.workspace_today(ws), public.workspace_today(ws)) b
    where b.user_id <> me
      and (exists (select 1 from public.workspace_group_members g1 join public.workspace_group_members g2 on g2.group_id = g1.group_id
                   where g1.workspace_id = ws and g1.user_id = b.user_id and g2.user_id = me)
           or not exists (select 1 from public.workspace_group_members g where g.workspace_id = ws and g.user_id = b.user_id))
      and not exists (select 1 from public.notifications n where n.user_id = me and n.workspace_id = ws and n.kind = 'birthday'
                      and n.actor_id = b.user_id and n.event_at = b.day::timestamp at time zone 'UTC');
    get diagnostics born = row_count;
    added := added + born;
  end if;
  return added;
end;
$$;
