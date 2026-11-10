-- Doba, phase 3a: a person's own calendar feed. A secret address shows, in any calendar
-- app, the events the person takes part in and their own approved time off (read-only).
-- Only the hash of the secret is kept; the feed itself is read by the server alone.
-- The same in supabase/team/migrations/0050_calendar_feeds.sql.
-- Rollback: supabase/rollbacks/20270104100000_calendar_feeds.down.sql

create table public.calendar_feeds (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- sha-256 of the secret in the address, as hex.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index calendar_feeds_user_idx on public.calendar_feeds (user_id);

-- Nobody reads or writes the table directly: the functions below do.
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from public, anon, authenticated;

-- Does the person have a feed here, and since when (never the secret or its hash).
create function public.my_calendar_feed(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) then jsonb_build_object('ok', false, 'error', 'forbidden')
    else jsonb_build_object('ok', true, 'created_at',
      (select f.created_at from public.calendar_feeds f where f.workspace_id = ws and f.user_id = auth.uid())) end;
$$;

-- A new address (the old one stops working at once). The server makes the secret and
-- passes only its hash.
create function public.set_calendar_feed(ws uuid, new_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_workspace_member(ws) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if new_hash is null or new_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into public.calendar_feeds (workspace_id, user_id, token_hash)
  values (ws, auth.uid(), new_hash)
  on conflict (workspace_id, user_id) do update set token_hash = excluded.token_hash, created_at = now();
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'invalid');
end;
$$;

create function public.drop_calendar_feed(ws uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  delete from public.calendar_feeds where workspace_id = ws and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- What a feed shows, for the server only: the events its person organizes or takes part
-- in (not the declined ones) from 30 days back to a year ahead — no descriptions — and
-- the person's own approved time off. Nothing once the person is no longer a member.
create function public.calendar_feed(ws uuid, hash text)
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

revoke execute on function public.my_calendar_feed(uuid), public.set_calendar_feed(uuid, text), public.drop_calendar_feed(uuid), public.calendar_feed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.my_calendar_feed(uuid), public.set_calendar_feed(uuid, text), public.drop_calendar_feed(uuid) to authenticated;
-- The server's role (absent in a plain test database).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.calendar_feed(uuid, text) to service_role;
  end if;
end $$;
