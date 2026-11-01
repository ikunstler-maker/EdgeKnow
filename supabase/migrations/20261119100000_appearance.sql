-- The angler fish in the sidebar and its lure (the feedback button): each person
-- may hide the fish, and show the lure bright, subdued (translucent white) or
-- not at all. Both are on for everyone to begin with. Kept in the profile, so
-- they follow the person to other devices.
-- Rollback: supabase/rollbacks/20261119100000_appearance.down.sql

alter table public.profiles
  add column show_mascot boolean not null default true,
  add column lure text not null default 'bright' check (lure in ('bright', 'subtle', 'hidden'));

create function public.set_my_appearance(new_show_mascot boolean, new_lure text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if new_lure is not null and new_lure not in ('bright', 'subtle', 'hidden') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  update public.profiles
  set show_mascot = coalesce(new_show_mascot, show_mascot), lure = coalesce(new_lure, lure)
  where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_my_appearance(boolean, text) from public, anon, authenticated;
grant execute on function public.set_my_appearance(boolean, text) to authenticated;
