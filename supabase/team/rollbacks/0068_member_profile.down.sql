-- Undo 0068_member_profile.
drop function public.set_member_birthday_date(uuid, uuid, integer, integer);
drop function public.set_member_job_title(uuid, uuid, text);
drop function public.member_card(uuid, uuid);
create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  -- Their birthday is forgotten too (the start date stays for the time-off records).
  update public.leave_member_settings set birth_month = null, birth_day = null, birth_year = null, birthday_shown = true
  where workspace_id = old.workspace_id and user_id = old.user_id and birth_month is not null;
  return null;
end;
$$;
alter table public.leave_member_settings drop column job_title;
