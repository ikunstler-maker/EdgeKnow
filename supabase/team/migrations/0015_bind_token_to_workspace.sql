-- An EdgeKnow token works only in the database of the workspace it was given
-- for (security fix of path C). Every team trusts the same EdgeKnow issuer and
-- the owner of a team's project can read the requests it receives, so without
-- this a token of someone in two teams, seen by one team, would work in the
-- other team's database until it expires (10 minutes).
-- Rollback: supabase/team/rollbacks/0015_bind_token_to_workspace.down.sql
--
-- Before the first sync (team_settings.workspace_id and issuer still empty)
-- nothing changes, and that is safe: the issuer arrives with that same sync, so
-- until then no EdgeKnow token is recognised here at all; EdgeKnow sign-in is
-- added to the project only after the migrations and the first sync (step
-- "sign_in" of the setup), and without synced members RLS opens nothing anyway.
create or replace function public.edgeknow_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ours text;
  workspace uuid;
begin
  select s.issuer, s.workspace_id into ours, workspace from public.team_settings s;
  if ours is null or coalesce(auth.jwt() ->> 'iss', '') <> ours then
    return;
  end if;
  -- Even with a leaked signing key, a token from our issuer can't claim an admin role here.
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'EdgeKnow tokens are for signed-in people only' using errcode = '42501';
  end if;
  -- Only a token given for this workspace.
  if workspace is not null and coalesce(auth.jwt() ->> 'ek_workspace', '') <> workspace::text then
    raise exception 'This EdgeKnow token is for another workspace' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.edgeknow_guard() to public;
