-- Doba, phase 2c (holidays, accrual by itself, start dates) in a team's own database
-- (as supabase/migrations/20270102100000_leave_holidays.sql).
-- Rollback: supabase/team/rollbacks/0048_leave_holidays.down.sql

-- Holidays: a list per workspace, kept by who manages time off. A holiday isn't taken
-- from the balance by policies that count working days (calendar-day policies take
-- every day in a row). A holiday added later changes no request that is already made.
create table public.leave_holidays (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  day           date not null,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, day)
);

-- When a person started work: who started within a year gets that year's norm in
-- proportion to the months left (the month of the start counts as a whole one).
create table public.leave_member_settings (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  started_on    date,
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- How a policy's norm arrives: by the button ("manual"), by itself on 1 January
-- ("yearly"), or month by month on the 1st ("monthly").
alter table public.leave_policies
  add column accrual text not null default 'manual' check (accrual in ('manual', 'yearly', 'monthly'));

-- A monthly part of the norm is its own kind of ledger row, one per month.
alter table public.leave_balances
  add column month smallint check (month between 1 and 12),
  drop constraint leave_balances_kind_check,
  add constraint leave_balances_kind_check check (kind in ('accrual', 'carry_over', 'adjustment', 'monthly')),
  add constraint leave_balances_monthly_check check ((kind = 'monthly') = (month is not null));
create unique index leave_balances_monthly_idx on public.leave_balances (policy_id, user_id, year, month) where kind = 'monthly';

alter table public.leave_holidays enable row level security;
alter table public.leave_member_settings enable row level security;
revoke all on public.leave_holidays, public.leave_member_settings from public, anon, authenticated;
grant select on public.leave_holidays, public.leave_member_settings to authenticated;
create policy "Members (not guests) see the holidays" on public.leave_holidays
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.leave_visible(workspace_id, auth.uid()));
-- A start date: the person's own, or all of them for who manages time off (not for leads).
create policy "Own start date, or all for who manages time off" on public.leave_member_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.leave_visible(workspace_id, auth.uid())
         and (user_id = auth.uid() or public.can_manage_leave(workspace_id)));

-- How many days of a policy a period takes — now without the workspace's holidays for
-- policies that count working days.
create or replace function public.leave_days(ws uuid, counting text, first_day date, last_day date, part text)
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
       or (extract(isodow from d)::smallint = any (coalesce((select s.work_days from public.calendar_settings s where s.workspace_id = ws), '{1,2,3,4,5}'::smallint[]))
           and not exists (select 1 from public.leave_holidays h where h.workspace_id = ws and h.day = d::date))
  ) c;
$$;

-- The norm of a year for a person: whole, or — for who started within that year — in
-- proportion to the months from the month of the start to December (that month counts
-- as a whole one), rounded up to half a day. Who starts after that year gets nothing.
create function public.leave_norm(target_policy uuid, person uuid, target_year integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.started_on is null or extract(year from s.started_on) < target_year then p.days_per_year
    when extract(year from s.started_on) > target_year then 0
    else ceil(p.days_per_year * (13 - extract(month from s.started_on)) / 12 * 2) / 2
  end::numeric(6,1)
  from public.leave_policies p
  left join public.leave_member_settings s on s.workspace_id = p.workspace_id and s.user_id = person
  where p.id = target_policy;
$$;
revoke execute on function public.leave_norm(uuid, uuid, integer) from public, anon, authenticated;

-- What a monthly policy should have given by the end of a month: the running total
-- "norm × months gone / months of the year for this person", rounded to half a day —
-- so the parts differ a little (1.5, 2, 1.5 …) and the year adds up to the norm exactly.
create function public.leave_due_by_month(target_policy uuid, person uuid, target_year integer, upto_month integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (case when m.gone <= 0 then 0 else round(public.leave_norm(target_policy, person, target_year) * least(m.gone, m.whole) / m.whole * 2) / 2 end)::numeric(6,1)
  from (
    select 13 - f.first_month as whole, upto_month - f.first_month + 1 as gone
    from (
      select case when s.started_on is not null and extract(year from s.started_on) = target_year then extract(month from s.started_on)::integer else 1 end as first_month
      from public.leave_policies p
      left join public.leave_member_settings s on s.workspace_id = p.workspace_id and s.user_id = person
      where p.id = target_policy
    ) f
  ) m;
$$;
revoke execute on function public.leave_due_by_month(uuid, uuid, integer, integer) from public, anon, authenticated;

-- One person's accrual of a policy for a year, brought up to what is due — only the
-- difference is written, so running it again (or after the way of accrual changed in
-- the middle of a year) never gives anything twice. Returns what was added.
-- With the first row of the year comes last year's rest, within the policy's limit.
create function public.leave_accrue_person(target_policy uuid, person uuid, target_year integer, upto_month integer, monthly boolean, actor uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.leave_policies;
  due numeric;
  given numeric;
  rest numeric;
  first_of_year boolean;
begin
  select * into p from public.leave_policies where id = target_policy;
  due := case when monthly then public.leave_due_by_month(p.id, person, target_year, upto_month) else public.leave_norm(p.id, person, target_year) end;
  select coalesce(sum(b.days), 0), count(*) = 0 into given, first_of_year
  from public.leave_balances b
  where b.policy_id = p.id and b.user_id = person and b.year = target_year and b.kind in ('accrual', 'monthly');
  if due - given <= 0 then
    return 0;
  end if;
  if monthly then
    insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, month, days, created_by)
    values (p.workspace_id, p.id, person, target_year, 'monthly', upto_month, due - given, actor)
    on conflict do nothing;
  else
    insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, created_by)
    values (p.workspace_id, p.id, person, target_year, 'accrual', due - given, actor)
    on conflict do nothing;
  end if;
  if not found then
    return 0;
  end if;
  if first_of_year then
    select least(p.carry_over_max, n.granted - n.used) into rest from public.leave_numbers(p.id, person, target_year - 1) n;
    if rest > 0 then
      insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, created_by)
      values (p.workspace_id, p.id, person, target_year, 'carry_over', rest, actor)
      on conflict do nothing;
    end if;
  end if;
  return due - given;
end;
$$;
revoke execute on function public.leave_accrue_person(uuid, uuid, integer, integer, boolean, uuid) from public, anon, authenticated;

-- "Accrue for everyone": every member is brought up to what is due — the whole norm
-- (in proportion for who started this year), or for a monthly policy what is due by
-- this month. Pressed again, it adds only what is missing.
create or replace function public.accrue_leave_year(ws uuid, target_policy uuid, target_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.leave_policies;
  today date := public.leave_today(ws);
  this_year integer := extract(year from public.leave_today(ws));
  person uuid;
  added integer := 0;
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  select * into p from public.leave_policies where id = target_policy and workspace_id = ws;
  if p.id is null or not p.active or target_year is null or target_year not in (this_year, this_year + 1) then
    return public.page_error('invalid');
  end if;
  -- A monthly policy can't run ahead into the next year.
  if p.accrual = 'monthly' and target_year <> this_year then
    return public.page_error('invalid');
  end if;
  for person in
    select m.user_id from public.workspace_members m where m.workspace_id = ws and m.status = 'active' and m.role <> 'guest'
  loop
    if public.leave_accrue_person(p.id, person, target_year, extract(month from today)::integer, p.accrual = 'monthly', auth.uid()) > 0 then
      added := added + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', added);
end;
$$;

-- The daily run (the server's cleanup calls it in every database): policies that accrue
-- by themselves are brought up to date for every member. Missing a day loses nothing.
create function public.run_leave_accruals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.leave_policies;
  today date;
  person uuid;
  added integer := 0;
begin
  for p in select * from public.leave_policies where active and not unlimited and accrual in ('yearly', 'monthly') loop
    today := public.leave_today(p.workspace_id);
    for person in
      select m.user_id from public.workspace_members m where m.workspace_id = p.workspace_id and m.status = 'active' and m.role <> 'guest'
    loop
      if public.leave_accrue_person(p.id, person, extract(year from today)::integer, extract(month from today)::integer, p.accrual = 'monthly', null) > 0 then
        added := added + 1;
      end if;
    end loop;
  end loop;
  return added;
end;
$$;
revoke execute on function public.run_leave_accruals() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_leave_accruals() to service_role;
  end if;
end;
$$;

-- Holidays: one day at a time, and "the same as last year" (same day and month; what is
-- already there stays).
create function public.save_leave_holiday(ws uuid, holiday date, title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  if holiday is null or extract(year from holiday) not between 2000 and 2200 or char_length(btrim(coalesce(title, ''))) not between 1 and 80 then
    return public.page_error('invalid');
  end if;
  if (select count(*) from public.leave_holidays h where h.workspace_id = ws) >= 2000 then
    return public.page_error('too_many');
  end if;
  insert into public.leave_holidays (workspace_id, day, name, created_by) values (ws, holiday, btrim(title), auth.uid())
  on conflict (workspace_id, day) do update set name = excluded.name;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.delete_leave_holiday(ws uuid, holiday date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  delete from public.leave_holidays where workspace_id = ws and day = holiday;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.copy_leave_holidays(ws uuid, from_year integer, to_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
begin
  if not public.can_manage_leave(ws) then
    return public.page_error('forbidden');
  end if;
  if from_year is null or to_year is null or from_year = to_year or to_year not between 2000 and 2200 then
    return public.page_error('invalid');
  end if;
  insert into public.leave_holidays (workspace_id, day, name, created_by)
  select ws, make_date(to_year, extract(month from h.day)::integer, extract(day from h.day)::integer), h.name, auth.uid()
  from public.leave_holidays h
  where h.workspace_id = ws and extract(year from h.day) = from_year
    -- 29 February exists only in a leap year.
    and (extract(month from h.day) <> 2 or extract(day from h.day) <> 29 or (to_year % 4 = 0 and (to_year % 100 <> 0 or to_year % 400 = 0)))
  on conflict (workspace_id, day) do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('ok', true, 'added', added);
end;
$$;

-- The start date of a person (null: unknown — the whole norm).
create function public.set_leave_start_date(ws uuid, person uuid, started date)
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
     or (started is not null and extract(year from started) not between 1950 and 2200) then
    return public.page_error('invalid');
  end if;
  insert into public.leave_member_settings (workspace_id, user_id, started_on, updated_by) values (ws, person, started, auth.uid())
  on conflict (workspace_id, user_id) do update set started_on = excluded.started_on, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- The policy keeps how its norm arrives.
create or replace function public.save_leave_policy(ws uuid, policy_id uuid, fields jsonb)
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
     or coalesce(fields ->> 'accrual', 'manual') not in ('manual', 'yearly', 'monthly')
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
                                       show_kind, allow_negative, unlimited, active, accrual, position, created_by)
    values (ws, btrim(fields ->> 'name'), fields ->> 'kind', per_year, carry, coalesce(fields ->> 'count_days', 'working'),
            coalesce((fields ->> 'requires_approval')::boolean, true), coalesce((fields ->> 'requires_deputy')::boolean, false),
            coalesce((fields ->> 'show_kind')::boolean, false), coalesce((fields ->> 'allow_negative')::boolean, false),
            coalesce((fields ->> 'unlimited')::boolean, false), coalesce((fields ->> 'active')::boolean, true), coalesce(fields ->> 'accrual', 'manual'),
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
      accrual = coalesce(fields ->> 'accrual', p.accrual),
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
create or replace function public.my_leave(ws uuid, target_year integer)
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
    'started_on', (select s.started_on from public.leave_member_settings s where s.workspace_id = ws and s.user_id = auth.uid()),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'days_per_year', p.days_per_year, 'carry_over_max', p.carry_over_max,
        'count_days', p.count_days, 'requires_approval', p.requires_approval, 'requires_deputy', p.requires_deputy, 'show_kind', p.show_kind,
        'allow_negative', p.allow_negative, 'unlimited', p.unlimited, 'active', p.active, 'accrual', p.accrual,
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
create or replace function public.leave_inbox(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid()) then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(x) order by (x.status = 'pending') desc, x.start_date desc) from (
      select r.id, r.user_id, coalesce(pr.name, pr.email) as person, p.name as policy, p.unlimited, p.count_days, r.start_date, r.end_date, r.half, r.days, r.comment, r.status,
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
create or replace function public.team_absences(ws uuid, first_day date, last_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_workspace_member(ws) or public.is_guest(ws, auth.uid())
                   or first_day is null or last_day is null or last_day < first_day or last_day - first_day > 400 then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'person', coalesce(pr.name, pr.email), 'start_date', r.start_date, 'end_date', r.end_date,
        'half', r.half, 'remote', p.kind = 'remote', 'working_only', p.count_days = 'working', 'deputy', coalesce(d.name, d.email),
        'label', case when p.show_kind or r.user_id = auth.uid() or public.leave_can_decide(ws, r.user_id, auth.uid()) then p.name end)
      order by r.start_date, coalesce(pr.name, pr.email))
    from public.leave_requests r
    join public.leave_policies p on p.id = r.policy_id
    join public.profiles pr on pr.id = r.user_id
    left join public.profiles d on d.id = r.deputy_id
    where r.workspace_id = ws and r.status = 'approved' and r.start_date <= last_day and r.end_date >= first_day), '[]'::jsonb) end;
$$;
create or replace function public.leave_balance_sheet(ws uuid, target_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_manage_leave(ws) then public.page_error('forbidden') else jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(pr.name, pr.email),
        'started_on', (select s.started_on from public.leave_member_settings s where s.workspace_id = ws and s.user_id = m.user_id), 'numbers', (
        select coalesce(jsonb_object_agg(p.id, jsonb_build_object('granted', n.granted, 'used', n.used, 'pending', n.pending)), '{}'::jsonb)
        from public.leave_policies p cross join lateral public.leave_numbers(p.id, m.user_id, target_year) n
        where p.workspace_id = ws and p.active)) order by coalesce(pr.name, pr.email))
    from public.workspace_members m join public.profiles pr on pr.id = m.user_id
    where m.workspace_id = ws and m.status = 'active' and m.role <> 'guest'), '[]'::jsonb)) end;
$$;
revoke execute on function
  public.save_leave_holiday(uuid, date, text),
  public.delete_leave_holiday(uuid, date),
  public.copy_leave_holidays(uuid, integer, integer),
  public.set_leave_start_date(uuid, uuid, date)
from public, anon;
grant execute on function
  public.save_leave_holiday(uuid, date, text),
  public.delete_leave_holiday(uuid, date),
  public.copy_leave_holidays(uuid, integer, integer),
  public.set_leave_start_date(uuid, uuid, date)
to authenticated;
