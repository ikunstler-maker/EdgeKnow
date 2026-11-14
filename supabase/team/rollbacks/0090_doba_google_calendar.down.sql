-- Undo 0090_doba_google_calendar.
drop function public.calendar_person_events(uuid, uuid, timestamptz, timestamptz);
create or replace function public.calendar_busy(ws uuid, people uuid[], range_from timestamptz, range_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'all_day', b.all_day)
                            order by b.user_id, b.starts_at, b.ends_at), '[]'::jsonb)
  from (
    (select distinct a.user_id, o.starts_at, o.ends_at, e.all_day
     from public.calendar_event_attendees a
     join public.calendar_events e on e.id = a.event_id
     cross join lateral public.calendar_event_occurrences(e.id, range_from, range_to) o
     where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
       and cardinality(coalesce(people, '{}')) between 1 and 50
       and range_to > range_from and range_to <= range_from + interval '100 days'
       and e.workspace_id = ws and e.deleted_at is null
       and a.user_id = any (people) and a.status in ('invited', 'accepted', 'tentative')
       and e.starts_at < range_to + interval '32 days'
       and case when e.repeat_freq is null then e.ends_at > range_from
                else e.repeat_until is null or e.repeat_until >= (range_from - interval '40 days')::date end
     limit 5000)
    union
    (select x.user_id, x.starts_at, x.ends_at, x.all_day
     from public.calendar_external_busy x
     where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
       and cardinality(coalesce(people, '{}')) between 1 and 50
       and range_to > range_from and range_to <= range_from + interval '100 days'
       and x.workspace_id = ws and x.user_id = any (people)
       and x.starts_at < range_to and x.ends_at > range_from
       and public.is_active_member(ws, x.user_id)
     limit 5000)
  ) b;
$$;
create or replace function public.set_calendar_external_busy(ws uuid, person uuid, slots jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  kept integer := 0;
begin
  delete from public.calendar_external_busy where workspace_id = ws and user_id = person;
  if slots is null or jsonb_typeof(slots) <> 'array' or not public.is_active_member(ws, person) or public.is_guest(ws, person) then
    return 0;
  end if;
  insert into public.calendar_external_busy (workspace_id, user_id, starts_at, ends_at, all_day)
  select ws, person, s.starts_at, s.ends_at, coalesce(s.all_day, false)
  from (
    select distinct (x ->> 'starts_at')::timestamptz as starts_at, (x ->> 'ends_at')::timestamptz as ends_at, (x ->> 'all_day')::boolean as all_day
    from jsonb_array_elements(slots) x
  ) s
  where s.starts_at is not null and s.ends_at is not null
    and s.ends_at > s.starts_at and s.ends_at <= s.starts_at + interval '100 days' and s.ends_at > now()
  order by s.starts_at
  limit 2000;
  get diagnostics kept = row_count;
  return kept;
end;
$$;
alter table public.calendar_external_busy drop column busy, drop column title;
