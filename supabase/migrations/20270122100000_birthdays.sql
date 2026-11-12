-- Doba: birthdays kept per person — in the calendar every year, on the home screen and
-- in the bell (decision 2026-11-12).
-- The same in supabase/team/migrations/0067_birthdays.sql.
-- Rollback: supabase/rollbacks/20270122100000_birthdays.down.sql

-- A birthday is kept per person and workspace, next to the start date: day and month,
-- and a year only if given (shown to the person and to who manages time off, never to
-- colleagues). The person decides whether colleagues see it; the workspace whether
-- birthdays are shown at all.
alter table public.leave_member_settings
  add column birth_month    smallint check (birth_month between 1 and 12),
  add column birth_day      smallint check (birth_day between 1 and 31),
  add column birth_year     smallint check (birth_year between 1900 and 2100),
  add column birthday_shown boolean not null default true,
  add constraint leave_member_settings_birthday_check check (
    (birth_month is null) = (birth_day is null) and (birth_year is null or birth_month is not null)
    and (birth_month is null or birth_day <= extract(day from (make_date(2000, birth_month, 1) + interval '1 month - 1 day'))::int)
    and (birth_year is null or birth_month is null or birth_month <> 2 or birth_day <> 29
         or (birth_year % 4 = 0 and (birth_year % 100 <> 0 or birth_year % 400 = 0))));

alter table public.calendar_settings
  add column show_birthdays boolean not null default true;

-- The workspace's own today (its time zone; UTC when it has none).
create function public.workspace_today(ws uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select s.time_zone from public.calendar_settings s where s.workspace_id = ws), 'UTC'))::date;
$$;

-- May the caller see this person's birthday? Members (not guests) of a workspace that
-- shows birthdays, for an active member (not a guest) who allows it; one always sees one's own.
create function public.birthday_visible(ws uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
    and public.is_active_member(ws, person) and not public.is_guest(ws, person)
    and exists (select 1 from public.leave_member_settings s
                where s.workspace_id = ws and s.user_id = person and s.birth_month is not null
                  and (person = auth.uid() or (s.birthday_shown and coalesce((select c.show_birthdays from public.calendar_settings c where c.workspace_id = ws), true))));
$$;

-- The birthdays the caller may see between two days (at most about a year): whose,
-- the name, and the day it falls on. 29 February is the 28th in other years. No year of birth.
create function public.birthdays_between(ws uuid, first_day date, last_day date)
returns table (user_id uuid, name text, day date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, coalesce(p.name, p.email), d.day
  from public.leave_member_settings s
  join public.profiles p on p.id = s.user_id
  cross join lateral (
    select make_date(y, s.birth_month::int,
                     case when s.birth_month = 2 and s.birth_day = 29 and not (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0)) then 28 else s.birth_day::int end) as day
    from generate_series(extract(year from first_day)::int, extract(year from last_day)::int) y
  ) d
  where s.workspace_id = ws and s.birth_month is not null
    and last_day >= first_day and last_day <= first_day + 400
    and d.day between first_day and last_day
    and public.birthday_visible(ws, s.user_id)
  order by d.day, 2;
$$;

-- For the calendar and the home screen.
create function public.calendar_birthdays(ws uuid, first_day date, last_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', b.name, 'day', b.day, 'mine', b.user_id = auth.uid()) order by b.day, b.name), '[]'::jsonb)
  from public.birthdays_between(ws, first_day, last_day) b;
$$;

-- One's own birthday as kept (with the year), and whether the workspace shows birthdays.
create function public.my_birthday(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then public.page_error('forbidden')
    else jsonb_build_object('ok', true,
      'month', s.birth_month, 'day', s.birth_day, 'year', s.birth_year, 'shown', coalesce(s.birthday_shown, true),
      'workspace_on', coalesce((select c.show_birthdays from public.calendar_settings c where c.workspace_id = ws), true)) end
  from (select 1) one
  left join public.leave_member_settings s on s.workspace_id = ws and s.user_id = auth.uid();
$$;

-- Checks a birthday; null when it is fine.
create function public.birthday_problem(month integer, day integer, year integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when month is null and day is null and year is null then null
    when month is null or day is null or month not between 1 and 12 or day < 1 then 'invalid'
    when day > extract(day from (make_date(2000, month, 1) + interval '1 month - 1 day'))::int then 'invalid'
    when year is not null and (year < 1900 or year > extract(year from now())::int) then 'invalid'
    when year is not null and month = 2 and day = 29 and not (year % 4 = 0 and (year % 100 <> 0 or year % 400 = 0)) then 'invalid'
    else null end;
$$;

-- The person sets (or clears, with nulls) their own birthday and whether colleagues see it.
create function public.set_my_birthday(ws uuid, month integer, day integer, year integer, shown boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then
    return public.page_error('forbidden');
  end if;
  if public.birthday_problem(month, day, year) is not null then
    return public.page_error('invalid');
  end if;
  insert into public.leave_member_settings (workspace_id, user_id, birth_month, birth_day, birth_year, birthday_shown, updated_by)
  values (ws, auth.uid(), month, day, case when month is null then null else year end, coalesce(shown, true), auth.uid())
  on conflict (workspace_id, user_id) do update
    set birth_month = excluded.birth_month, birth_day = excluded.birth_day, birth_year = excluded.birth_year,
        birthday_shown = excluded.birthday_shown, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Who manages time off sets (or clears) a member's birthday; whether colleagues see it
-- stays the person's own choice.
create function public.set_member_birthday(ws uuid, person uuid, month integer, day integer, year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = person and m.status = 'active' and m.role <> 'guest')
     or public.birthday_problem(month, day, year) is not null then
    return public.page_error('invalid');
  end if;
  insert into public.leave_member_settings (workspace_id, user_id, birth_month, birth_day, birth_year, updated_by)
  values (ws, person, month, day, case when month is null then null else year end, auth.uid())
  on conflict (workspace_id, user_id) do update
    set birth_month = excluded.birth_month, birth_day = excluded.birth_day, birth_year = excluded.birth_year,
        updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- The owner and admins: are birthdays shown in this workspace at all.
create function public.set_calendar_birthdays(ws uuid, shown boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) or not public.is_workspace_admin(ws) then
    return public.page_error('forbidden');
  end if;
  insert into public.calendar_settings (workspace_id, show_birthdays, updated_by)
  values (ws, coalesce(shown, true), auth.uid())
  on conflict (workspace_id) do update set show_birthdays = excluded.show_birthdays, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- A birthday in the bell.
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday'));

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
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
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
                                          'mine', l.user_id = auth.uid(), 'deputy', coalesce(l.deputy_id = auth.uid(), false)) end as leave,
             -- A birthday: whose and which day — while it may still be seen.
             case when n.kind = 'birthday' and public.birthday_visible(ws, n.actor_id)
                  then jsonb_build_object('person', coalesce(a.name, a.email), 'day', (n.event_at at time zone 'UTC')::date) end as birthday
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
      ) l),
    -- The person's own birthday (day and month only), as a yearly whole day.
    'birthday', (
      select jsonb_build_object('month', s.birth_month, 'day', s.birth_day)
      from public.leave_member_settings s
      where s.workspace_id = ws and s.user_id = person and s.birth_month is not null));
end;
$$;

create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  -- Their birthday is forgotten too (the start date stays for the time-off records).
  update public.leave_member_settings set birth_month = null, birth_day = null, birth_year = null, birthday_shown = true
  where workspace_id = old.workspace_id and user_id = old.user_id and birth_month is not null;
  return null;
end;
$$;

revoke execute on function
  public.workspace_today(uuid),
  public.birthday_visible(uuid, uuid),
  public.birthdays_between(uuid, date, date),
  public.calendar_birthdays(uuid, date, date),
  public.my_birthday(uuid),
  public.birthday_problem(integer, integer, integer),
  public.set_my_birthday(uuid, integer, integer, integer, boolean),
  public.set_member_birthday(uuid, uuid, integer, integer, integer),
  public.set_calendar_birthdays(uuid, boolean)
from public, anon;
revoke execute on function public.workspace_today(uuid), public.birthday_visible(uuid, uuid), public.birthdays_between(uuid, date, date), public.birthday_problem(integer, integer, integer)
  from authenticated;
grant execute on function
  public.calendar_birthdays(uuid, date, date),
  public.my_birthday(uuid),
  public.set_my_birthday(uuid, integer, integer, integer, boolean),
  public.set_member_birthday(uuid, uuid, integer, integer, integer),
  public.set_calendar_birthdays(uuid, boolean)
to authenticated;
