-- Undo 0048_leave_holidays.
drop function public.set_leave_start_date(uuid, uuid, date);
drop function public.copy_leave_holidays(uuid, integer, integer);
drop function public.delete_leave_holiday(uuid, date);
drop function public.save_leave_holiday(uuid, date, text);
drop function public.run_leave_accruals();
create or replace function public.leave_balance_sheet(ws uuid, target_year integer)
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
        'half', r.half, 'remote', p.kind = 'remote', 'deputy', coalesce(d.name, d.email),
        'label', case when p.show_kind or r.user_id = auth.uid() or public.leave_can_decide(ws, r.user_id, auth.uid()) then p.name end)
      order by r.start_date, coalesce(pr.name, pr.email))
    from public.leave_requests r
    join public.leave_policies p on p.id = r.policy_id
    join public.profiles pr on pr.id = r.user_id
    left join public.profiles d on d.id = r.deputy_id
    where r.workspace_id = ws and r.status = 'approved' and r.start_date <= last_day and r.end_date >= first_day), '[]'::jsonb) end;
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
create or replace function public.accrue_leave_year(ws uuid, target_policy uuid, target_year integer)
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
drop function public.leave_accrue_person(uuid, uuid, integer, integer, boolean, uuid);
drop function public.leave_due_by_month(uuid, uuid, integer, integer);
drop function public.leave_norm(uuid, uuid, integer);
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
       or extract(isodow from d)::smallint = any (coalesce((select s.work_days from public.calendar_settings s where s.workspace_id = ws), '{1,2,3,4,5}'::smallint[]))
  ) c;
$$;
-- Monthly parts become one yearly accrual each, so no balance changes.
insert into public.leave_balances (workspace_id, policy_id, user_id, year, kind, days, created_by)
select b.workspace_id, b.policy_id, b.user_id, b.year, 'accrual', sum(b.days), null
from public.leave_balances b
where b.kind = 'monthly'
  and not exists (select 1 from public.leave_balances a where a.policy_id = b.policy_id and a.user_id = b.user_id and a.year = b.year and a.kind = 'accrual')
group by b.workspace_id, b.policy_id, b.user_id, b.year;
update public.leave_balances a set days = a.days + m.days
from (select policy_id, user_id, year, sum(days) as days, min(created_at) as first_at from public.leave_balances where kind = 'monthly' group by 1, 2, 3) m
where a.kind = 'accrual' and a.policy_id = m.policy_id and a.user_id = m.user_id and a.year = m.year and a.created_at < m.first_at;
delete from public.leave_balances where kind = 'monthly';
drop index public.leave_balances_monthly_idx;
alter table public.leave_balances
  drop constraint leave_balances_monthly_check,
  drop constraint leave_balances_kind_check,
  drop column month,
  add constraint leave_balances_kind_check check (kind in ('accrual', 'carry_over', 'adjustment'));
alter table public.leave_policies drop column accrual;
drop table public.leave_member_settings;
drop table public.leave_holidays;
