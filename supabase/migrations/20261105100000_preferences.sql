-- Personal interface preferences: theme and language, kept in the profile so
-- they follow the person to every device (the browser also keeps a cookie so
-- the first render already has them).
-- Rollback: supabase/rollbacks/20261105100000_preferences.down.sql

alter table public.profiles
  add column theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  add column locale text not null default 'uk' check (locale in ('uk', 'en'));

-- null leaves a preference as it is. Only for the caller's own profile.
create function public.set_my_preferences(new_theme text, new_locale text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if new_theme is not null and new_theme not in ('system', 'light', 'dark') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if new_locale is not null and new_locale not in ('uk', 'en') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  update public.profiles
  set theme = coalesce(new_theme, theme), locale = coalesce(new_locale, locale)
  where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_my_preferences(text, text) from public, anon, authenticated;
grant execute on function public.set_my_preferences(text, text) to authenticated;
