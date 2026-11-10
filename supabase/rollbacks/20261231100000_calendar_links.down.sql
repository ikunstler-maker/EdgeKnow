-- Undo 20261231100000_calendar_links.
drop function public.calendar_event_chips(uuid[]);
drop function public.search_calendar_events(uuid, text);
drop function public.calendar_event_next_start(uuid);
drop function public.calendar_tasks(uuid, date, date, boolean);
create or replace function public.split_calendar_event(target uuid, occurrence date, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e public.calendar_events;
  problem text;
  rule record;
  before integer;
  new_fields jsonb := fields;
  new_id uuid;
  person uuid;
begin
  select * into e from public.calendar_events where id = target for update;
  if e.id is null or not public.is_workspace_member(e.workspace_id) or e.organizer_id is distinct from me then
    return public.page_error('forbidden');
  end if;
  if e.deleted_at is not null then
    return public.page_error('cancelled');
  end if;
  if occurrence is null or not public.calendar_series_has(target, occurrence) then
    return public.page_error('not_found');
  end if;
  -- From the first day on it is simply the whole series.
  if occurrence <= (e.starts_at at time zone e.time_zone)::date then
    return public.update_calendar_event(target, fields) || jsonb_build_object('id', target);
  end if;
  problem := public.calendar_event_problem(fields);
  if problem is not null then
    return public.page_error(problem);
  end if;
  -- "After N times" counted from the very start: the new part gets what is left of it.
  if e.repeat_count is not null and (fields #>> '{repeat,count}') is not null and (fields #>> '{repeat,count}')::integer = e.repeat_count then
    select count(*) into before
    from public.calendar_series(e.starts_at, e.ends_at, e.time_zone, e.repeat_freq, e.repeat_interval, e.repeat_days, occurrence - 1,
                                e.starts_at - interval '1 day', e.starts_at + interval '70 years');
    new_fields := jsonb_set(fields, '{repeat,count}', to_jsonb(greatest(e.repeat_count - before, 1)));
  end if;
  select * into rule from public.calendar_repeat_columns(new_fields);
  update public.calendar_events set repeat_until = occurrence - 1, repeat_count = null, updated_at = now() where id = target;
  delete from public.calendar_event_exceptions where event_id = target and occurrence_date >= occurrence;
  insert into public.calendar_events (workspace_id, title, description, location, meeting_url, starts_at, ends_at, all_day, time_zone, visibility, organizer_id, created_by,
                                      repeat_freq, repeat_interval, repeat_days, repeat_until, repeat_count, reminder_minutes)
  values (e.workspace_id, btrim(fields ->> 'title'), coalesce(fields ->> 'description', ''), btrim(coalesce(fields ->> 'location', '')),
          nullif(btrim(coalesce(fields ->> 'meeting_url', '')), ''), (fields ->> 'starts_at')::timestamptz, (fields ->> 'ends_at')::timestamptz,
          coalesce((fields ->> 'all_day')::boolean, false), coalesce(fields ->> 'time_zone', 'UTC'), fields ->> 'visibility', me, me,
          rule.freq, rule.every, rule.week_days, rule.last_day, rule.times, (fields ->> 'reminder_minutes')::smallint)
  returning id into new_id;
  insert into public.calendar_event_attendees (event_id, workspace_id, user_id, status, invited_by, created_at, responded_at)
  select new_id, a.workspace_id, a.user_id, a.status, a.invited_by, a.created_at, a.responded_at
  from public.calendar_event_attendees a
  where a.event_id = target and (fields ->> 'visibility' = 'request' or a.status not in ('requested', 'rejected'));
  for person in select a.user_id from public.calendar_event_attendees a where a.event_id = new_id and a.status in ('invited', 'accepted', 'tentative') loop
    perform public.notify_event(e.workspace_id, person, 'event_change', me, new_id);
  end loop;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;
drop function public.refresh_calendar_event_units(uuid);
drop function public.invite_unit_to_calendar_event(uuid, uuid);
alter table public.calendar_events drop column invited_group_ids;
