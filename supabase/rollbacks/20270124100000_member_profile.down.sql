-- Undo 20270124100000_member_profile.
-- Uploaded pictures stay in storage (like files on Drive); an empty bucket goes.
delete from storage.buckets b where b.id = 'avatars' and not exists (select 1 from storage.objects o where o.bucket_id = 'avatars');
drop function public.set_my_avatar(text);
drop function public.set_my_name(text);
create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        name       = excluded.name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;
alter table public.profiles drop column name_custom, drop column avatar_custom;
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
