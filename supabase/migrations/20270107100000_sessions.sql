-- Active sessions (devices): an admin sees a member's devices and ends all their
-- sessions; a person sees and ends their own. Reads Supabase's own auth.sessions,
-- no new table. Only the kind of device and times leave the database, never the IP
-- or the full browser string. An ended session loses access on its next request:
-- current_email() (under every access check) requires the token's session to exist.

-- The token's session, if it names one (Supabase user tokens always do).
create function public.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid;
$$;

-- Signed-in email; none once the token's session was ended (signed out, or ended by an admin).
create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
    and (public.current_session_id() is null
         or exists (select 1 from auth.sessions s where s.id = public.current_session_id() and s.user_id = u.id));
$$;

-- For the proxy: the token's session was ended, so the browser should sign in again.
create function public.session_alive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_id() is null
    or exists (select 1 from auth.sessions s where s.id = public.current_session_id() and s.user_id = auth.uid());
$$;

-- Phone, tablet or computer, from the browser string (nothing else of it is shown).
create function public.session_device_kind(agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when agent is null or agent = '' then 'unknown'
    when agent ~* '(ipad|tablet)' or (agent ~* 'android' and agent !~* 'mobile') then 'tablet'
    when agent ~* '(mobi|iphone|ipod|android)' then 'phone'
    else 'computer'
  end;
$$;

-- Live sessions of one person as the screen shows them, newest activity first.
create function public.session_list(person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'kind', public.session_device_kind(s.user_agent),
      'signed_in_at', s.created_at,
      'active_at', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
      'current', s.id = public.current_session_id()
    ) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc), '[]'::jsonb)
  from auth.sessions s
  where s.user_id = person and (s.not_after is null or s.not_after > now());
$$;

-- Owner and admins: a member's devices (a member of this workspace only).
create function public.member_sessions(ws uuid, member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_admin(ws)
     or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = member and m.status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'sessions', public.session_list(member));
end;
$$;

-- Owner and admins end all of a member's sessions (signed out everywhere, in every
-- workspace). Admins can't do it to the owner; logged in the workspace's journal.
create function public.end_member_sessions(ws uuid, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
  ended int;
begin
  select m.role into target_role from public.workspace_members m
  where m.workspace_id = ws and m.user_id = member and m.status = 'active';
  if not public.is_workspace_admin(ws) or target_role is null
     or (target_role = 'owner' and member <> auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  delete from auth.sessions s where s.user_id = member;
  get diagnostics ended = row_count;
  insert into public.audit_log (workspace_id, actor_id, action, details)
  values (ws, auth.uid(), 'sessions_ended',
          jsonb_build_object('email', (select p.email from public.profiles p where p.id = member), 'count', ended));
  return jsonb_build_object('ok', true, 'ended', ended);
end;
$$;

-- One's own devices.
create function public.my_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_email() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'sessions', public.session_list(auth.uid()));
end;
$$;

-- End one of one's own sessions, or (target null) all but this one.
create function public.end_my_sessions(target uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended int;
begin
  if public.current_email() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  delete from auth.sessions s
  where s.user_id = auth.uid()
    and s.id is distinct from public.current_session_id()
    and (target is null or s.id = target);
  get diagnostics ended = row_count;
  return jsonb_build_object('ok', true, 'ended', ended);
end;
$$;

revoke all on function public.current_session_id() from public, anon, authenticated;
revoke all on function public.session_alive() from public, anon, authenticated;
revoke all on function public.session_device_kind(text) from public, anon, authenticated;
revoke all on function public.session_list(uuid) from public, anon, authenticated;
revoke all on function public.member_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_member_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_sessions() from public, anon, authenticated;
revoke all on function public.end_my_sessions(uuid) from public, anon, authenticated;
grant execute on function public.session_alive() to authenticated;
grant execute on function public.member_sessions(uuid, uuid) to authenticated;
grant execute on function public.end_member_sessions(uuid, uuid) to authenticated;
grant execute on function public.my_sessions() to authenticated;
grant execute on function public.end_my_sessions(uuid) to authenticated;
