-- Path C registry: server-only, and the sync payload holds the effective
-- members of one workspace only.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000013a1', 'alice@sync.test', now()),
 ('00000000-0000-0000-0000-0000000013b1', 'bob@sync.test', now()),
 ('00000000-0000-0000-0000-0000000013e1', 'eve@other-sync.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000013a1';
select public.create_workspace('Sync') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'sync.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000013b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000013e1';
select public.create_workspace('Other sync') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

select 'payload: ' || jsonb_build_object(
  'members', (select jsonb_agg(p.email || ' ' || (m ->> 'role') order by p.email) from jsonb_array_elements(public.team_sync_payload(:'ws') -> 'members') m join public.profiles p on p.id = (m ->> 'user_id')::uuid),
  'profiles', jsonb_array_length(public.team_sync_payload(:'ws') -> 'profiles'),
  'drive', public.team_sync_payload(:'ws') -> 'settings' -> 'files_on_drive')::text;

-- Domain switched off: Bob, who came through it, is no longer an effective member.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000013a1';
select public.set_workspace_domain_active(:'ws', 'sync.test', false) ->> 'ok' as ignored \gset
reset role;
select 'after domain off: ' || jsonb_array_length(public.team_sync_payload(:'ws') -> 'members');
select 'unknown workspace: ' || coalesce(public.team_sync_payload(gen_random_uuid())::text, 'null');

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000013a1';
select public.team_sync_payload(:'ws');
select count(*) from public.team_databases;
insert into public.team_databases (workspace_id, project_url, publishable_key, secret_key_encrypted) values (:'ws', 'https://x.test', 'k', 'e');
set role anon;
select public.team_sync_payload(:'ws');
reset role;
\set ON_ERROR_STOP 1
