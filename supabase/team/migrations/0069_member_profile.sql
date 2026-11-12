-- Profile: job title, departments and teams in a team's own database
-- (as supabase/migrations/20270124100000_member_profile.sql; names and pictures stay central).
-- Rollback: supabase/team/rollbacks/0069_member_profile.down.sql

-- A job title per person and workspace, next to the start date and the birthday.
alter table public.leave_member_settings
  add column job_title text check (job_title is null or char_length(job_title) between 1 and 80);

-- A person's card in this workspace: name, picture, role, job title, departments
-- (top-level units) and teams (lower units) of the units they are in, and the birthday
-- (day and month only) if the caller may see it (who manages time off sees every one). Members see everyone; a guest only
-- themselves. Also says what the caller may change on the card.
create function public.member_card(ws uuid, person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive units as (
    select g.id, g.parent_id, g.name, g.id as own_id, g.parent_id is null as is_top
    from public.workspace_groups g
    join public.workspace_group_members gm on gm.group_id = g.id
    where g.workspace_id = ws and gm.user_id = person
    union all
    select p.id, p.parent_id, p.name, u.own_id, false
    from units u
    join public.workspace_groups p on p.id = u.parent_id
  )
  select case
    when auth.uid() is null or not public.is_workspace_member(ws)
         or (person <> auth.uid() and public.is_guest(ws, auth.uid()))
         or not public.is_active_member(ws, person) then public.page_error('forbidden')
    else jsonb_build_object('ok', true,
      'name', coalesce(p.name, p.email),
      'avatar_url', p.avatar_url,
      'role', m.role,
      'job_title', s.job_title,
      'departments', coalesce((select jsonb_agg(distinct u.name) from units u where u.parent_id is null), '[]'::jsonb),
      'teams', coalesce((select jsonb_agg(distinct u.name) from units u where u.id = u.own_id and not u.is_top), '[]'::jsonb),
      'birthday', case when s.birth_month is not null and (public.birthday_visible(ws, person) or public.can_manage_leave(ws))
                       then jsonb_build_object('month', s.birth_month, 'day', s.birth_day) end,
      'can_edit_title', person = auth.uid() or public.is_workspace_admin(ws),
      'can_edit_birthday', person <> auth.uid() and not public.is_guest(ws, person) and public.can_manage_leave(ws)) end
  from public.profiles p
  join public.workspace_members m on m.workspace_id = ws and m.user_id = p.id
  left join public.leave_member_settings s on s.workspace_id = ws and s.user_id = p.id
  where p.id = person
  union all
  select public.page_error('forbidden')
  where not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = person)
  limit 1;
$$;

-- The person themselves, or the owner and admins, set (or clear, with null) a job title.
create function public.set_member_job_title(ws uuid, person uuid, title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(btrim(regexp_replace(coalesce(title, ''), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is null or not public.is_workspace_member(ws)
     or not (person = auth.uid() or public.is_workspace_admin(ws)) then
    return public.page_error('forbidden');
  end if;
  if not public.is_active_member(ws, person) or char_length(coalesce(clean, '')) > 80 then
    return public.page_error('invalid');
  end if;
  insert into public.leave_member_settings (workspace_id, user_id, job_title, updated_by)
  values (ws, person, clean, auth.uid())
  on conflict (workspace_id, user_id) do update
    set job_title = excluded.job_title, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Who manages time off (the owner and admins among them) sets a member's birthday from
-- their profile: day and month only. A year kept for the same day stays; a new day drops it.
create function public.set_member_birthday_date(ws uuid, person uuid, month integer, day integer)
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
     or (month is null) <> (day is null) or public.birthday_problem(month, day, null) is not null then
    return public.page_error('invalid');
  end if;
  insert into public.leave_member_settings (workspace_id, user_id, birth_month, birth_day, updated_by)
  values (ws, person, month, day, auth.uid())
  on conflict (workspace_id, user_id) do update
    set birth_year = case when leave_member_settings.birth_month = excluded.birth_month and leave_member_settings.birth_day = excluded.birth_day
                          then leave_member_settings.birth_year end,
        birth_month = excluded.birth_month, birth_day = excluded.birth_day,
        updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Removal from the workspace forgets the job title too.
create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  -- Their birthday and job title are forgotten too (the start date stays for the time-off records).
  update public.leave_member_settings set birth_month = null, birth_day = null, birth_year = null, birthday_shown = true, job_title = null
  where workspace_id = old.workspace_id and user_id = old.user_id and (birth_month is not null or job_title is not null);
  return null;
end;
$$;

revoke execute on function
  public.member_card(uuid, uuid),
  public.set_member_job_title(uuid, uuid, text),
  public.set_member_birthday_date(uuid, uuid, integer, integer)
from public, anon;
grant execute on function
  public.member_card(uuid, uuid),
  public.set_member_job_title(uuid, uuid, text),
  public.set_member_birthday_date(uuid, uuid, integer, integer)
to authenticated;
