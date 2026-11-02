-- A token from EdgeKnow works only in the database of the workspace it was
-- given for; before the first sync the guard behaves as before.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ON_ERROR_STOP 0

-- Before the first sync of this database (fresh settings, as right after the migrations).
begin;
update public.team_settings set issuer = null, workspace_id = null where id;
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated"}';
select 'before the first sync, any token passes as before: ok' || coalesce(public.edgeknow_guard()::text, '');
rollback;

-- After the sync (team1 synced workspace …f1 with this issuer).
select 'synced for: ' || workspace_id from public.team_settings;
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}';
select 'a token for this workspace: ok' || coalesce(public.edgeknow_guard()::text, '');
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","ek_workspace":"00000000-0000-0000-0000-0000000000f2"}';
select 'a token for another workspace: passed (wrong)' || coalesce(public.edgeknow_guard()::text, '');
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated"}';
select 'a token without a workspace: passed (wrong)' || coalesce(public.edgeknow_guard()::text, '');
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"service_role","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}';
select 'an admin role, even for this workspace: passed (wrong)' || coalesce(public.edgeknow_guard()::text, '');
set request.jwt.claims = '{"iss":"https://supabase.test/auth/v1","role":"authenticated"}';
select 'the project''s own sign-in is not ours to check: ok' || coalesce(public.edgeknow_guard()::text, '');
reset request.jwt.claims;
