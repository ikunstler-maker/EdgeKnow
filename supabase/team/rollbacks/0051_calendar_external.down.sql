-- Undo 0051_calendar_external.
drop trigger calendar_forget_deleted_member on public.workspace_members;
drop trigger calendar_forget_removed_member on public.workspace_members;
drop function public.calendar_forget_member();
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
    select distinct a.user_id, o.starts_at, o.ends_at, e.all_day
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
    limit 5000
  ) b;
$$;
drop function public.set_calendar_external_busy(uuid, uuid, jsonb);
drop table public.calendar_external_busy;
