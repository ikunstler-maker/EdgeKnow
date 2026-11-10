-- Doba, phase 3b (busy time from a person's outside calendar) in a team's own database
-- (as supabase/migrations/20270105100000_calendar_external.sql, without the address table).
-- Rollback: supabase/team/rollbacks/0051_calendar_external.down.sql

-- Busy time read from a person's outside calendar: starts and ends only — no titles,
-- places or people are ever kept. Replaced as a whole on every refresh.
create table public.calendar_external_busy (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  -- A whole-day slot keeps its dates as UTC midnights, like a whole-day event.
  all_day       boolean not null default false,
  check (ends_at > starts_at and ends_at <= starts_at + interval '100 days')
);
create index calendar_external_busy_person_idx on public.calendar_external_busy (workspace_id, user_id, starts_at);
create index calendar_external_busy_user_idx on public.calendar_external_busy (user_id);

-- A person reads only their own slots (the calendar marks them, "My data" exports them);
-- colleagues get them through calendar_busy, as anonymous busy time. Nobody writes directly.
alter table public.calendar_external_busy enable row level security;
revoke all on public.calendar_external_busy from public, anon, authenticated;
grant select on public.calendar_external_busy to authenticated;
create policy "Own busy time from an outside calendar" on public.calendar_external_busy
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and user_id = auth.uid());

-- The server replaces a person's slots after reading their outside calendar. What has
-- already ended is not kept; an empty list clears everything.
create function public.set_calendar_external_busy(ws uuid, person uuid, slots jsonb)
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
revoke execute on function public.set_calendar_external_busy(uuid, uuid, jsonb) from public, anon, authenticated;
-- The server's role (absent in a plain test database).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_calendar_external_busy(uuid, uuid, jsonb) to service_role;
  end if;
end $$;

-- Someone removed from the workspace: their outside busy time goes at once.
create function public.calendar_forget_member()
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
revoke execute on function public.calendar_forget_member() from public, anon, authenticated;
create trigger calendar_forget_removed_member
  after update of status on public.workspace_members
  for each row when (new.status = 'removed' and old.status is distinct from 'removed')
  execute function public.calendar_forget_member();
create trigger calendar_forget_deleted_member
  after delete on public.workspace_members
  for each row execute function public.calendar_forget_member();

-- When these people are busy: their events, and now also the slots of their outside
-- calendars — the same anonymous start and end, with nothing to tell them apart.
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
