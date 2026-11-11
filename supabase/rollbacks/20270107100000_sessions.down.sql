-- Undo 20270107100000_sessions: current_email() no longer looks at the session.

create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

drop function public.end_my_sessions(uuid);
drop function public.my_sessions();
drop function public.end_member_sessions(uuid, uuid);
drop function public.member_sessions(uuid, uuid);
drop function public.session_list(uuid);
drop function public.session_device_kind(text);
drop function public.session_alive();
drop function public.current_session_id();
