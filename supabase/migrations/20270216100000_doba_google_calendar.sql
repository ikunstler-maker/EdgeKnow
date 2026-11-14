-- DOBA-1: Doba, phase 3c — a person's calendar connected by signing in with the provider
-- (decisions 2027-02-01 and 2026-11-13): titles of their own outside events (to them
-- alone), the app's own "Doba" calendar at the provider, a video meeting link.
-- The same (without the CENTRAL ONLY part) in supabase/team/migrations/0090_doba_google_calendar.sql.
-- Rollback: supabase/rollbacks/20270216100000_doba_google_calendar.down.sql

-- Titles of the person's own outside events (read only through a provider sign-in; a
-- feed address still gives starts and ends only) and whether an event makes them busy.
-- Colleagues never get either: calendar_busy hands out plain busy time, busy slots only.
alter table public.calendar_external_busy
  add column title text check (title is null or char_length(title) <= 300),
  add column busy boolean not null default true;

-- The server replaces a person's slots after reading their outside calendar. What has
-- already ended is not kept; an empty list clears everything.
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
  insert into public.calendar_external_busy (workspace_id, user_id, starts_at, ends_at, all_day, title, busy)
  select ws, person, s.starts_at, s.ends_at, coalesce(s.all_day, false), nullif(left(btrim(coalesce(s.title, '')), 300), ''), coalesce(s.busy, true)
  from (
    select distinct (x ->> 'starts_at')::timestamptz as starts_at, (x ->> 'ends_at')::timestamptz as ends_at, (x ->> 'all_day')::boolean as all_day,
           x ->> 'title' as title, (x ->> 'busy')::boolean as busy
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

-- When these people are busy: their events, and the busy slots of their outside
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
    (select distinct x.user_id, x.starts_at, x.ends_at, x.all_day
     from public.calendar_external_busy x
     where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
       and cardinality(coalesce(people, '{}')) between 1 and 50
       and range_to > range_from and range_to <= range_from + interval '100 days'
       and x.workspace_id = ws and x.user_id = any (people) and x.busy
       and x.starts_at < range_to and x.ends_at > range_from
       and public.is_active_member(ws, x.user_id)
     limit 5000)
  ) b;
$$;

-- For the server only: the Doba events a member takes part in (organizes, or is invited
-- to and has not declined), each day of a series on its own, as the "Doba" calendar at
-- the provider should show them. No descriptions. Null for someone not (or no longer)
-- an active member, or a guest.
create function public.calendar_person_events(ws uuid, person uuid, range_from timestamptz, range_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if person is null or not public.is_active_member(ws, person) or public.is_guest(ws, person)
     or range_to <= range_from or range_to > range_from + interval '100 days' then
    return null;
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at, x.id), '[]'::jsonb) from (
      select e.id, o.title, o.location, o.meeting_url, o.starts_at, o.ends_at, e.all_day,
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
      limit 1000
    ) x);
end;
$$;
revoke execute on function public.calendar_person_events(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
-- The server's role (absent in a plain test database).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.calendar_person_events(uuid, uuid, timestamptz, timestamptz) to service_role;
  end if;
end $$;

-- CENTRAL ONLY
-- A connection is now one of two kinds: a feed address (3b) or a sign-in with the
-- provider (3c). Both stay closed to everyone; only the server reads and writes them.
-- The access of a sign-in is encrypted with CALENDAR_TOKEN_KEY, like the address, and
-- is never in a team database, a backup, "My data" or a log.
alter table public.calendar_connections
  alter column url_encrypted drop not null,
  add column kind text not null default 'feed' check (kind in ('feed', 'google')),
  add column token_encrypted text check (token_encrypted is null or char_length(token_encrypted) between 1 and 6000),
  add column account_email text check (account_email is null or char_length(account_email) <= 320),
  -- The app's own "Doba" calendar at the provider (created on connecting).
  add column doba_calendar_id text check (doba_calendar_id is null or char_length(doba_calendar_id) <= 300),
  -- The last time the person's Doba events were written to it, and why not if it failed.
  add column pushed_at timestamptz,
  add column push_error text check (push_error is null or char_length(push_error) <= 60),
  add constraint calendar_connections_secret check (
    (kind = 'feed' and url_encrypted is not null and token_encrypted is null)
    or (kind = 'google' and token_encrypted is not null and url_encrypted is null));

-- A Doba event (one day of a series on its own) and its copy in the person's "Doba"
-- calendar at the provider. `item` is the event id, or "<event id>/<day>" for a series.
-- `fingerprint` tells whether the copy is still as the event is. Closed to everyone.
-- No link to the event itself: it may live in a team's own database.
create table public.calendar_external_links (
  workspace_id     uuid not null,
  user_id          uuid not null,
  item             text not null check (item ~ '^[0-9a-f-]{36}(/\d{4}-\d{2}-\d{2})?$'),
  event_id         uuid not null,
  remote_id        text not null check (char_length(remote_id) between 1 and 1024),
  fingerprint      text not null check (char_length(fingerprint) between 1 and 128),
  -- When the copy starts: copies of what is over are left as they are.
  starts_at        timestamptz not null,
  synced_at        timestamptz not null default now(),
  primary key (workspace_id, user_id, item),
  foreign key (workspace_id, user_id) references public.calendar_connections (workspace_id, user_id) on delete cascade
);
create index calendar_external_links_event_idx on public.calendar_external_links (workspace_id, event_id);
alter table public.calendar_external_links enable row level security;
revoke all on public.calendar_external_links from public, anon, authenticated;

-- Removed from the workspace: a feed address goes at once. A sign-in stays for the
-- server, which first takes the access back at the provider and then removes it (and
-- its links); until then nothing is read or written for that person (they are not an
-- active member, so set_calendar_external_busy and calendar_person_events refuse).
create or replace function public.calendar_forget_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_connections where workspace_id = old.workspace_id and user_id = old.user_id and kind = 'feed';
  return null;
end;
$$;
