-- Doba, phase 1b (time off) in a team's own database (as supabase/migrations/20261229100000_time_off.sql).
-- Rollback: supabase/team/rollbacks/0044_time_off.down.sql

-- Who sees what:
--   a request and a balance — the person, the leads of their units and of the units
--     above, the owner, admins and whoever has the role right "manage_leave" (HR);
--   colleagues — only approved absences: "absent" or "remote", the dates, the deputy
--     (the policy's name only when the policy allows it);
--   guests — nothing.
-- Nobody approves their own request. Balance = ledger rows of the year − approved days.

create table public.leave_policies (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  kind               text not null check (kind in ('vacation', 'sick', 'day_off', 'remote', 'other')),
  days_per_year      numeric(5,1) not null default 0 check (days_per_year between 0 and 366),
  carry_over_max     numeric(5,1) not null default 0 check (carry_over_max between 0 and 366),
  -- What a day of a request is: a working day of the week (calendar settings) or any day.
  count_days         text not null default 'working' check (count_days in ('working', 'calendar')),
  requires_approval  boolean not null default true,
  requires_deputy    boolean not null default false,
  -- Colleagues see this policy's name on the absence (off: just "absent").
  show_kind          boolean not null default false,
  -- A request may take the balance below zero.
  allow_negative     boolean not null default false,
  -- Used days are counted, but the balance never blocks a request (remote work).
  unlimited          boolean not null default false,
  active             boolean not null default true,
  position           double precision not null default 0,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index leave_policies_workspace_idx on public.leave_policies (workspace_id);

-- The ledger: every accrual, carry-over and manual correction is a row that never changes.
create table public.leave_balances (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  policy_id     uuid not null references public.leave_policies (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  year          integer not null check (year between 2000 and 2200),
  kind          text not null check (kind in ('accrual', 'carry_over', 'adjustment')),
  days          numeric(6,1) not null check (days between -366 and 366),
  note          text not null default '' check (char_length(note) <= 300),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (kind = 'adjustment' or days >= 0),
  check (kind <> 'adjustment' or (days <> 0 and char_length(btrim(note)) > 0))
);
-- One yearly accrual and one carry-over per person, policy and year: pressing
-- "accrue for the year" again adds only who is new.
create unique index leave_balances_yearly_idx on public.leave_balances (policy_id, user_id, year, kind) where kind in ('accrual', 'carry_over');
create index leave_balances_person_idx on public.leave_balances (workspace_id, user_id, year);

create table public.leave_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  -- No "on delete" action: a policy with requests can't be deleted on its own, yet a
  -- workspace that goes takes both (the check waits for the end of the statement).
  policy_id      uuid not null references public.leave_policies (id),
  start_date     date not null,
  end_date       date not null,
  -- Half a day: only for a single date.
  half           text check (half in ('first', 'second')),
  days           numeric(5,1) not null check (days > 0 and days <= 366),
  comment        text not null default '' check (char_length(comment) <= 1000),
  deputy_id      uuid references public.profiles (id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- The person's units when the request was made (plain ids: a unit may go later).
  group_ids      uuid[] not null default '{}',
  decided_by     uuid references public.profiles (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text not null default '' check (char_length(decision_note) <= 500),
  cancelled_by   uuid references public.profiles (id) on delete set null,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366),
  check (half is null or start_date = end_date),
  check (extract(year from start_date) = extract(year from end_date)),
  check (deputy_id is null or deputy_id <> user_id)
);
create index leave_requests_person_idx on public.leave_requests (workspace_id, user_id, start_date);
create index leave_requests_dates_idx on public.leave_requests (workspace_id, status, start_date, end_date);
create index leave_requests_policy_idx on public.leave_requests (policy_id);

-- May this person manage time off in the workspace (owner, admin, or the role right)?
create function public.leave_manager(ws uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role in ('owner', 'admin') then true
      when m.role = 'guest' then false
      else coalesce(
        (select (r.permissions ->> 'manage_leave')::boolean from public.workspace_roles r where r.id = m.custom_role_id and r.workspace_id = ws),
        (select (r.permissions ->> 'manage_leave')::boolean from public.workspace_roles r where r.workspace_id = ws and r.builtin = 'member'),
        false)
    end
    from public.workspace_members m
    where m.workspace_id = ws and m.user_id = person and m.status = 'active'
  ), false);
$$;
revoke execute on function public.leave_manager(uuid, uuid) from public, anon, authenticated;

-- The leads above a person: of their own units (level 0) and of every unit over those.
create function public.leave_leads_of(ws uuid, requester uuid)
returns table (user_id uuid, level integer)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select g.id, g.parent_id, 0 as level
    from public.workspace_groups g
    join public.workspace_group_members gm on gm.group_id = g.id
    where g.workspace_id = ws and gm.user_id = requester
    union all
    select g.id, g.parent_id, up.level + 1
    from public.workspace_groups g join up on g.id = up.parent_id
    where up.level < 10
  )
  select gm.user_id, min(up.level)
  from up
  join public.workspace_group_members gm on gm.group_id = up.id and gm.is_lead and gm.user_id <> requester
  join public.workspace_members m on m.workspace_id = ws and m.user_id = gm.user_id and m.status = 'active' and m.role <> 'guest'
  group by gm.user_id;
$$;
revoke execute on function public.leave_leads_of(uuid, uuid) from public, anon, authenticated;

-- May `person` see and decide on `requester`'s time off? Never one's own.
create function public.leave_can_decide(ws uuid, requester uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select person is not null and person <> requester
     and (public.leave_manager(ws, person) or exists (select 1 from public.leave_leads_of(ws, requester) l where l.user_id = person));
$$;
revoke execute on function public.leave_can_decide(uuid, uuid, uuid) from public, anon, authenticated;

-- For the row rules: the signed-in person and someone's time off.
create function public.leave_visible(ws uuid, owner_of_row uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
     and (owner_of_row = auth.uid() or public.leave_can_decide(ws, owner_of_row, auth.uid()));
$$;
revoke execute on function public.leave_visible(uuid, uuid) from public, anon;
grant execute on function public.leave_visible(uuid, uuid) to authenticated;

create function public.can_manage_leave(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws) and public.leave_manager(ws, auth.uid());
$$;
revoke execute on function public.can_manage_leave(uuid) from public, anon;
grant execute on function public.can_manage_leave(uuid) to authenticated;

alter table public.leave_policies enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
revoke all on public.leave_policies, public.leave_balances, public.leave_requests from public, anon, authenticated;
grant select on public.leave_policies, public.leave_balances, public.leave_requests to authenticated;

create policy "Members (not guests) see the time-off policies" on public.leave_policies
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.leave_visible(workspace_id, auth.uid()));
create policy "Own balance, or of the people one decides for" on public.leave_balances
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.leave_visible(workspace_id, user_id));
create policy "Own requests, or of the people one decides for" on public.leave_requests
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.leave_visible(workspace_id, user_id));

-- Notifications about time off.
alter table public.notifications
  add column leave_request_id uuid references public.leave_requests (id) on delete cascade,
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info'));
create index notifications_leave_idx on public.notifications (leave_request_id) where leave_request_id is not null;

-- 'leave_request' and 'leave_info' go to who decides, 'leave_decision' to the person,
-- 'leave_deputy' to the deputy; anyone else gets nothing.
create function public.notify_leave(person uuid, what text, actor uuid, about uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = about;
  if auth.uid() is null or r.id is null or person is null or person is not distinct from actor then
    return;
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = r.workspace_id and m.user_id = person and m.status = 'active' and m.role <> 'guest') then
    return;
  end if;
  if not (person = r.user_id or person is not distinct from r.deputy_id or public.leave_can_decide(r.workspace_id, r.user_id, person)) then
    return;
  end if;
  if exists (select 1 from public.notification_prefs p where p.workspace_id = r.workspace_id and p.user_id = person and what = any (p.muted)) then
    return;
  end if;
  if exists (select 1 from public.notifications n where n.user_id = person and n.kind = what and n.leave_request_id = about
             and n.created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, leave_request_id)
  values (r.workspace_id, person, what, actor, about);
end;
$$;
revoke execute on function public.notify_leave(uuid, text, uuid, uuid) from public, anon, authenticated;

-- Whom a new request goes to: the nearest leads above the person; with none in the
-- tree — the owner, admins and whoever manages time off.
create function public.notify_leave_deciders(what text, actor uuid, about uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leave_requests;
  person uuid;
  nearest integer;
begin
  select * into r from public.leave_requests where id = about;
  select min(l.level) into nearest from public.leave_leads_of(r.workspace_id, r.user_id) l;
  if nearest is not null then
    for person in select l.user_id from public.leave_leads_of(r.workspace_id, r.user_id) l where l.level = nearest loop
      perform public.notify_leave(person, what, actor, about);
    end loop;
  else
    for person in select m.user_id from public.workspace_members m
                  where m.workspace_id = r.workspace_id and m.status = 'active' and public.leave_manager(r.workspace_id, m.user_id) loop
      perform public.notify_leave(person, what, actor, about);
    end loop;
  end if;
end;
$$;
revoke execute on function public.notify_leave_deciders(text, uuid, uuid) from public, anon, authenticated;

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
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
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
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change',
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Today in the workspace's time zone.
create function public.leave_today(ws uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select s.time_zone from public.calendar_settings s where s.workspace_id = ws), 'UTC'))::date;
$$;
revoke execute on function public.leave_today(uuid) from public, anon, authenticated;

-- How many days of a policy a period takes.
create function public.leave_days(ws uuid, counting text, first_day date, last_day date, part text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when part is not null then least(n, 1) * 0.5 else n end
  from (
    select count(*)::numeric as n
    from generate_series(first_day, last_day, interval '1 day') d
    where counting = 'calendar'
       or extract(isodow from d)::smallint = any (coalesce((select s.work_days from public.calendar_settings s where s.workspace_id = ws), '{1,2,3,4,5}'::smallint[]))
  ) c;
$$;
revoke execute on function public.leave_days(uuid, text, date, date, text) from public, anon, authenticated;

-- A person's numbers for a policy and a year: what the ledger gave, what approved
-- requests took, what waits for a decision.
create function public.leave_numbers(target_policy uuid, person uuid, target_year integer)
returns table (granted numeric, used numeric, pending numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(b.days) from public.leave_balances b where b.policy_id = target_policy and b.user_id = person and b.year = target_year), 0),
    coalesce((select sum(r.days) from public.leave_requests r where r.policy_id = target_policy and r.user_id = person and r.status = 'approved'
              and extract(year from r.start_date) = target_year), 0),
    coalesce((select sum(r.days) from public.leave_requests r where r.policy_id = target_policy and r.user_id = person and r.status = 'pending'
              and extract(year from r.start_date) = target_year), 0);
$$;
revoke execute on function public.leave_numbers(uuid, uuid, integer) from public, anon, authenticated;

-- The four starting policies of a workspace (names in the manager's language), with 0
-- days: the workspace sets its own numbers. Only while there are no policies at all.
create function public.seed_leave_policies(ws uuid, names jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  if exists (select 1 from public.leave_policies p where p.workspace_id = ws) then
    return jsonb_build_object('ok', true, 'created', 0);
  end if;
  foreach label in array array['vacation', 'sick', 'day_off', 'remote'] loop
    if char_length(btrim(coalesce(names ->> label, ''))) not between 1 and 80 then
      return public.page_error('invalid');
    end if;
  end loop;
  insert into public.leave_policies (workspace_id, name, kind, requires_approval, show_kind, unlimited, position, created_by) values
    (ws, btrim(names ->> 'vacation'), 'vacation', true, false, false, 1, auth.uid()),
    (ws, btrim(names ->> 'sick'), 'sick', false, false, true, 2, auth.uid()),
    (ws, btrim(names ->> 'day_off'), 'day_off', true, false, false, 3, auth.uid()),
    (ws, btrim(names ->> 'remote'), 'remote', false, true, true, 4, auth.uid());
  return jsonb_build_object('ok', true, 'created', 4);
end;
$$;

-- A policy is made or changed (policy_id null: a new one). Policies are never deleted,
-- only switched off: requests keep pointing to them.
create function public.save_leave_policy(ws uuid, policy_id uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_year numeric;
  carry numeric;
  saved uuid;
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  begin
    per_year := coalesce((fields ->> 'days_per_year')::numeric, 0);
    carry := coalesce((fields ->> 'carry_over_max')::numeric, 0);
  exception when others then
    return public.page_error('invalid');
  end;
  if char_length(btrim(coalesce(fields ->> 'name', ''))) not between 1 and 80
     or coalesce(fields ->> 'kind', '') not in ('vacation', 'sick', 'day_off', 'remote', 'other')
     or coalesce(fields ->> 'count_days', 'working') not in ('working', 'calendar')
     or per_year not between 0 and 366 or carry not between 0 and 366
     or per_year * 2 <> trunc(per_year * 2) or carry * 2 <> trunc(carry * 2)
     or exists (select 1 from unnest(array['requires_approval', 'requires_deputy', 'show_kind', 'allow_negative', 'unlimited', 'active']) k
                where fields ? k and jsonb_typeof(fields -> k) <> 'boolean') then
    return public.page_error('invalid');
  end if;
  if policy_id is null then
    if (select count(*) from public.leave_policies p where p.workspace_id = ws) >= 30 then
      return public.page_error('too_many');
    end if;
    insert into public.leave_policies (workspace_id, name, kind, days_per_year, carry_over_max, count_days, requires_approval, requires_deputy,
                                       show_kind, allow_negative, unlimited, active, position, created_by)
    values (ws, btrim(fields ->> 'name'), fields ->> 'kind', per_year, carry, coalesce(fields ->> 'count_days', 'working'),
            coalesce((fields ->> 'requires_approval')::boolean, true), coalesce((fields ->> 'requires_deputy')::boolean, false),
            coalesce((fields ->> 'show_kind')::boolean, false), coalesce((fields ->> 'allow_negative')::boolean, false),
            coalesce((fields ->> 'unlimited')::boolean, false), coalesce((fields ->> 'active')::boolean, true),
            coalesce((select max(p.position) from public.leave_policies p where p.workspace_id = ws), 0) + 1, auth.uid())
    returning id into saved;
  else
    update public.leave_policies p set
      name = btrim(fields ->> 'name'), kind = fields ->> 'kind', days_per_year = per_year, carry_over_max = carry,
      count_days = coalesce(fields ->> 'count_days', p.count_days),
      requires_approval = coalesce((fields ->> 'requires_approval')::boolean, p.requires_approval),
      requires_deputy = coalesce((fields ->> 'requires_deputy')::boolean, p.requires_deputy),
      show_kind = coalesce((fields ->> 'show_kind')::boolean, p.show_kind),
      allow_negative = coalesce((fields ->> 'allow_negative')::boolean, p.allow_negative),
      unlimited = coalesce((fields ->> 'unlimited')::boolean, p.unlimited),
      active = coalesce((fields ->> 'active')::boolean, p.active),
      updated_at = now()
    where p.id = policy_id and p.workspace_id = ws
    returning p.id into saved;
    if saved is null then
      return public.page_error('not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

-- "Accrue for the year": the yearly norm, and last year's rest within the policy's
-- limit, for every member who has no accrual of this policy for this year yet.
-- Safe to press again: nobody gets it twice.
create function public.accrue_leave_year(ws uuid, target_policy uuid, target_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.leave_policies;
  this_year integer := extract(year from public.leave_today(ws));
  person uuid;
  rest numeric;
  added integer := 0;
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  select * into p from public.leave_policies where id = target_policy and workspace_id = ws;
  if p.id is null or not p.active or target_year is null or target_year not in (this_year, this_year + 1) then
    return public.page_error('invalid');
  end if;
  for person in
    select m.user_id from public.workspace_members m
    where m.workspace_id = ws and m.status = 'active' and m.role <> 'guest'
      and not exists (select 1 from public.leave_balances b where b.policy_id = p.id and b.user_id = m.user_id and b.year = target_year and b.kind = 'accrual')
  loop
    insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, created_by)
    values (ws, p.id, person, target_year, 'accrual', p.days_per_year, auth.uid())
    on conflict do nothing;
    if found then
      added := added + 1;
      select least(p.carry_over_max, n.granted - n.used) into rest from public.leave_numbers(p.id, person, target_year - 1) n;
      if rest > 0 then
        insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, created_by)
        values (ws, p.id, person, target_year, 'carry_over', rest, auth.uid())
        on conflict do nothing;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', added);
end;
$$;

-- A manual correction of one person's balance, always with a reason.
create function public.adjust_leave_balance(ws uuid, target_policy uuid, person uuid, target_year integer, delta numeric, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  if not exists (select 1 from public.leave_policies p where p.id = target_policy and p.workspace_id = ws)
     or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = person and m.status = 'active' and m.role <> 'guest')
     or delta is null or delta = 0 or delta not between -366 and 366 or delta * 2 <> trunc(delta * 2)
     or target_year is null or target_year not between 2000 and 2200
     or char_length(btrim(coalesce(reason, ''))) not between 1 and 300 then
    return public.page_error('invalid');
  end if;
  insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, note, created_by)
  values (ws, target_policy, person, target_year, 'adjustment', delta, btrim(reason), auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;

-- A request. With a policy that needs no approval it is active at once.
create function public.request_leave(ws uuid, target_policy uuid, first_day date, last_day date, part text, deputy uuid, note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.leave_policies;
  amount numeric;
  n record;
  new_id uuid;
  state text;
begin
  if not public.is_workspace_member(ws) or public.is_guest(ws, me) then
    return public.page_error('forbidden');
  end if;
  select * into p from public.leave_policies where id = target_policy and workspace_id = ws;
  if p.id is null or not p.active then
    return public.page_error('no_policy');
  end if;
  if first_day is null or last_day is null or last_day < first_day or last_day - first_day > 366
     or (part is not null and (part not in ('first', 'second') or first_day <> last_day))
     or char_length(coalesce(note, '')) > 1000 then
    return public.page_error('invalid');
  end if;
  if extract(year from first_day) <> extract(year from last_day) then
    return public.page_error('split_year');
  end if;
  if first_day < public.leave_today(ws) - 366 then
    return public.page_error('invalid');
  end if;
  if deputy is not null and (deputy = me or not exists (select 1 from public.workspace_members m
       where m.workspace_id = ws and m.user_id = deputy and m.status = 'active' and m.role <> 'guest')) then
    return public.page_error('bad_deputy');
  end if;
  if p.requires_deputy and deputy is null then
    return public.page_error('deputy_required');
  end if;
  -- One request at a time may reach this point for a person: the checks below count the others.
  perform pg_advisory_xact_lock(hashtextextended(ws::text || me::text, 53));
  -- Not over one's own request for the same days (two halves of one day may differ).
  if exists (select 1 from public.leave_requests r
             where r.workspace_id = ws and r.user_id = me and r.status in ('pending', 'approved')
               and r.start_date <= last_day and r.end_date >= first_day
               and (r.half is null or part is null or r.half = part)) then
    return public.page_error('overlap');
  end if;
  amount := public.leave_days(ws, p.count_days, first_day, last_day, part);
  if amount <= 0 then
    return public.page_error('no_days');
  end if;
  -- The balance counts what is approved and what still waits for a decision.
  if not p.unlimited and not p.allow_negative then
    select * into n from public.leave_numbers(p.id, me, extract(year from first_day)::integer);
    if n.granted - n.used - n.pending < amount then
      return public.page_error('no_balance');
    end if;
  end if;
  state := case when p.requires_approval then 'pending' else 'approved' end;
  insert into public.leave_requests (workspace_id, user_id, policy_id, start_date, end_date, half, days, comment, deputy_id, status, group_ids, decided_at)
  values (ws, me, p.id, first_day, last_day, part, amount, coalesce(note, ''), deputy, state,
          coalesce((select array_agg(gm.group_id) from public.workspace_group_members gm where gm.workspace_id = ws and gm.user_id = me), '{}'),
          case when p.requires_approval then null else now() end)
  returning id into new_id;
  if p.requires_approval then
    perform public.notify_leave_deciders('leave_request', me, new_id);
  else
    -- Nothing to decide: the lead and the deputy are just told.
    perform public.notify_leave_deciders('leave_info', me, new_id);
    perform public.notify_leave(deputy, 'leave_deputy', me, new_id);
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'status', state, 'days', amount);
end;
$$;

-- A lead above the person, the owner, an admin or HR approves or refuses; the first decision stands.
create function public.decide_leave_request(target uuid, approve boolean, note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = target for update;
  if r.id is null or not public.is_workspace_member(r.workspace_id) or public.is_guest(r.workspace_id, me)
     or not public.leave_can_decide(r.workspace_id, r.user_id, me) then
    return public.page_error('forbidden');
  end if;
  if r.status <> 'pending' then
    return public.page_error('decided');
  end if;
  if char_length(coalesce(note, '')) > 500 then
    return public.page_error('invalid');
  end if;
  update public.leave_requests set status = case when coalesce(approve, false) then 'approved' else 'rejected' end,
    decided_by = me, decided_at = now(), decision_note = coalesce(note, ''), updated_at = now()
  where id = target;
  perform public.notify_leave(r.user_id, 'leave_decision', me, target);
  if coalesce(approve, false) then
    perform public.notify_leave(r.deputy_id, 'leave_deputy', me, target);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Cancelling: the person — while it waits, or an approved one before its first day;
-- who decides — any time. The days are free again (a cancelled request counts nowhere).
create function public.cancel_leave_request(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.leave_requests;
  decider boolean;
begin
  select * into r from public.leave_requests where id = target for update;
  if r.id is null or not public.is_workspace_member(r.workspace_id) or public.is_guest(r.workspace_id, me) then
    return public.page_error('forbidden');
  end if;
  decider := public.leave_can_decide(r.workspace_id, r.user_id, me);
  if not decider and r.user_id <> me then
    return public.page_error('forbidden');
  end if;
  if r.status not in ('pending', 'approved') then
    return public.page_error('decided');
  end if;
  if not decider and r.status = 'approved' and r.start_date <= public.leave_today(r.workspace_id) then
    return public.page_error('started');
  end if;
  update public.leave_requests set status = 'cancelled', cancelled_by = me, cancelled_at = now(), updated_at = now() where id = target;
  perform public.notify_leave(r.user_id, 'leave_decision', me, target);
  if r.status = 'approved' then
    perform public.notify_leave(r.deputy_id, 'leave_deputy', me, target);
    if r.user_id = me then
      perform public.notify_leave_deciders('leave_info', me, target);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Who of the same units is already off (approved or waiting) in these days: names and
-- dates only. For the person's own request, and for who decides on it.
create function public.leave_unit_overlaps(ws uuid, person uuid, first_day date, last_day date, except_request uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(pr.name, pr.email), 'start_date', r.start_date, 'end_date', r.end_date, 'status', r.status)
                            order by r.start_date, coalesce(pr.name, pr.email)), '[]'::jsonb)
  from public.leave_requests r
  join public.profiles pr on pr.id = r.user_id
  where public.is_workspace_member(ws) and not public.is_guest(ws, auth.uid())
    and (person = auth.uid() or public.leave_can_decide(ws, person, auth.uid()))
    and r.workspace_id = ws and r.user_id <> person and r.status in ('pending', 'approved')
    and r.id is distinct from except_request
    and r.start_date <= last_day and r.end_date >= first_day
    and exists (select 1 from public.workspace_group_members mine
                join public.workspace_group_members theirs on theirs.group_id = mine.group_id
                where mine.workspace_id = ws and mine.user_id = person and theirs.user_id = r.user_id);
$$;

-- My page: the policies with my numbers for the year, and my requests.
create function public.my_leave(ws uuid, target_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then public.page_error('forbidden') else jsonb_build_object(
    'ok', true,
    'today', public.leave_today(ws),
    'manager', public.leave_manager(ws, auth.uid()),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'days_per_year', p.days_per_year, 'carry_over_max', p.carry_over_max,
        'count_days', p.count_days, 'requires_approval', p.requires_approval, 'requires_deputy', p.requires_deputy, 'show_kind', p.show_kind,
        'allow_negative', p.allow_negative, 'unlimited', p.unlimited, 'active', p.active,
        'granted', n.granted, 'used', n.used, 'pending', n.pending) order by p.position, p.created_at)
      from public.leave_policies p cross join lateral public.leave_numbers(p.id, auth.uid(), target_year) n
      where p.workspace_id = ws), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'policy_id', r.policy_id, 'start_date', r.start_date, 'end_date', r.end_date, 'half', r.half, 'days', r.days,
        'comment', r.comment, 'status', r.status, 'deputy', coalesce(d.name, d.email), 'decided_by', coalesce(b.name, b.email), 'decision_note', r.decision_note,
        'created_at', r.created_at) order by r.start_date desc, r.created_at desc)
      from public.leave_requests r
      left join public.profiles d on d.id = r.deputy_id
      left join public.profiles b on b.id = coalesce(r.cancelled_by, r.decided_by)
      where r.workspace_id = ws and r.user_id = auth.uid() and extract(year from r.start_date) = target_year), '[]'::jsonb))
  end;
$$;

-- For who decides: the requests of the people they decide for — waiting ones first.
create function public.leave_inbox(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(x) order by (x.status = 'pending') desc, x.start_date desc) from (
      select r.id, r.user_id, coalesce(pr.name, pr.email) as person, p.name as policy, p.unlimited, r.start_date, r.end_date, r.half, r.days, r.comment, r.status,
             coalesce(d.name, d.email) as deputy, r.decision_note, r.created_at,
             n.granted - n.used as balance
      from public.leave_requests r
      join public.leave_policies p on p.id = r.policy_id
      join public.profiles pr on pr.id = r.user_id
      left join public.profiles d on d.id = r.deputy_id
      cross join lateral public.leave_numbers(r.policy_id, r.user_id, extract(year from r.start_date)::integer) n
      where r.workspace_id = ws and r.user_id <> auth.uid()
        and (r.status = 'pending' or r.end_date >= public.leave_today(ws) - 30)
        and public.leave_can_decide(ws, r.user_id, auth.uid())
      order by (r.status = 'pending') desc, r.start_date desc
      limit 300
    ) x), '[]'::jsonb) end;
$$;

-- For HR: every member's numbers for the year.
create function public.leave_balance_sheet(ws uuid, target_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_manage_leave(ws) then public.page_error('forbidden') else jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(pr.name, pr.email), 'numbers', (
        select coalesce(jsonb_object_agg(p.id, jsonb_build_object('granted', n.granted, 'used', n.used, 'pending', n.pending)), '{}'::jsonb)
        from public.leave_policies p cross join lateral public.leave_numbers(p.id, m.user_id, target_year) n
        where p.workspace_id = ws and p.active)) order by coalesce(pr.name, pr.email))
    from public.workspace_members m join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = ws and m.status = 'active' and m.role <> 'guest'), '[]'::jsonb)) end;
$$;

-- What every member (not a guest) sees: approved absences of a period — who, the
-- dates, the deputy, and "remote" or "absent". The policy's name only when it allows.
-- One's own, and those one decides for, always come with the name.
create function public.team_absences(ws uuid, first_day date, last_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid())
                   or first_day is null or last_day is null or last_day < first_day or last_day - first_day > 400 then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'person', coalesce(pr.name, pr.email), 'start_date', r.start_date, 'end_date', r.end_date,
        'half', r.half, 'remote', p.kind = 'remote', 'deputy', coalesce(d.name, d.email),
        'label', case when p.show_kind or r.user_id = auth.uid() or public.leave_can_decide(ws, r.user_id, auth.uid()) then p.name end)
      order by r.start_date, coalesce(pr.name, pr.email))
    from public.leave_requests r
    join public.leave_policies p on p.id = r.policy_id
    join public.profiles pr on pr.id = r.user_id
    left join public.profiles d on d.id = r.deputy_id
    where r.workspace_id = ws and r.status = 'approved' and r.start_date <= last_day and r.end_date >= first_day), '[]'::jsonb) end;
$$;

revoke execute on function
  public.seed_leave_policies(uuid, jsonb),
  public.save_leave_policy(uuid, uuid, jsonb),
  public.accrue_leave_year(uuid, uuid, integer),
  public.adjust_leave_balance(uuid, uuid, uuid, integer, numeric, text),
  public.request_leave(uuid, uuid, date, date, text, uuid, text),
  public.decide_leave_request(uuid, boolean, text),
  public.cancel_leave_request(uuid),
  public.leave_unit_overlaps(uuid, uuid, date, date, uuid),
  public.my_leave(uuid, integer),
  public.leave_inbox(uuid),
  public.leave_balance_sheet(uuid, integer),
  public.team_absences(uuid, date, date)
from public, anon;
grant execute on function
  public.seed_leave_policies(uuid, jsonb),
  public.save_leave_policy(uuid, uuid, jsonb),
  public.accrue_leave_year(uuid, uuid, integer),
  public.adjust_leave_balance(uuid, uuid, uuid, integer, numeric, text),
  public.request_leave(uuid, uuid, date, date, text, uuid, text),
  public.decide_leave_request(uuid, boolean, text),
  public.cancel_leave_request(uuid),
  public.leave_unit_overlaps(uuid, uuid, date, date, uuid),
  public.my_leave(uuid, integer),
  public.leave_inbox(uuid),
  public.leave_balance_sheet(uuid, integer),
  public.team_absences(uuid, date, date)
to authenticated;

