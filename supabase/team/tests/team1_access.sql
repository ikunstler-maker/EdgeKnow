-- Team database (path C): membership comes only from the central service,
-- pages follow the same rules as before, removed members lose access, and
-- tokens from EdgeKnow can act only as a signed-in person.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set issuer 'https://wiki.test/oidc'
\set ws '00000000-0000-0000-0000-0000000000f1'
\set alice '00000000-0000-0000-0000-0000000000a1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set carol '00000000-0000-0000-0000-0000000000c1'

-- Signed in as someone: what PostgREST sets from an EdgeKnow token.
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test"}'''

-- Before the central service has synced anything, nobody is a member.
set role authenticated;
:as_alice;
select 'before sync: ' || (public.create_page(:'ws', null, 'Too early') ->> 'error');
reset role;

-- Only the secret key may sync.
\set ON_ERROR_STOP 0
set role authenticated;
select public.team_sync('{}');
set role anon;
select public.team_sync('{}');
reset role;
\set ON_ERROR_STOP 1

set role service_role;
select 'sync: ' || public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice', 'storage_limit_mb', 50),
  'settings', jsonb_build_object('issuer', :'issuer', 'files_on_drive', false),
  'profiles', jsonb_build_array(
    jsonb_build_object('id', :'alice', 'email', 'alice@team.test', 'name', 'Alice'),
    jsonb_build_object('id', :'bob', 'email', 'bob@team.test', 'name', 'Bob'),
    jsonb_build_object('id', :'carol', 'email', 'carol@team.test', 'name', 'Carol')),
  'members', jsonb_build_array(
    jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'),
    jsonb_build_object('user_id', :'bob', 'role', 'member', 'joined_via', 'domain'))
))::text;
select 'second workspace refused: ' || (public.team_sync(jsonb_build_object('workspace', jsonb_build_object('id', gen_random_uuid(), 'short_id', 'other001', 'name', 'Other', 'owner_id', :'alice'))) ->> 'error');
reset role;

set role authenticated;
:as_alice;
select public.create_page(:'ws', null, 'Handbook') ->> 'id' as page \gset
select 'save: ' || (public.save_page_content(:'page', '[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"Welcome to the team","styles":{}}],"children":[]}]', 1, false) ->> 'ok');
select public.create_page(:'ws', null, 'Private notes') ->> 'id' as private_page \gset
select 'team: a page with the browser''s id, twice: ' || (public.create_page_at(:'ws', null, 'Quick page', '00000000-0000-0000-0000-00000000aaf1') ->> 'id') || ' ' || (public.create_page_at(:'ws', null, 'Quick page', '00000000-0000-0000-0000-00000000aaf1') ->> 'ok');
select 'share with workspace: ' || (public.set_page_workspace_role(:'page', 'viewer') ->> 'ok');
select 'share with bob: ' || (public.set_page_member_role(:'private_page', :'bob', 'editor') ->> 'ok');
select 'alice sees: ' || string_agg(title, ', ' order by title) from public.pages;

:as_bob;
select 'bob sees: ' || string_agg(p.title || ' (' || public.my_role(p) || ')', ', ' order by p.title) from public.pages p;
select 'bob searches: ' || count(*) from public.search_pages(:'ws', 'welcome', null, null);
select 'bob (viewer) may not comment: ' || (public.create_comment_thread(:'page', 'Welcome', 'Hi!', '{}') ->> 'ok');
select 'bob sees people: ' || string_agg(name, ', ' order by name) from public.profiles;
\set ON_ERROR_STOP 0
select count(*) from public.team_settings;
\set ON_ERROR_STOP 1

-- Carol has a profile here but isn't a member.
:as_carol;
select 'carol sees pages: ' || count(*) from public.pages;
select 'carol creates: ' || (public.create_page(:'ws', null, 'Mine') ->> 'error');
select 'carol sees members: ' || count(*) from public.workspace_members;
reset role;

-- No direct writes.
\set ON_ERROR_STOP 0
set role authenticated;
:as_carol;
insert into public.workspace_members (workspace_id, user_id, role, joined_via) values (:'ws', :'carol', 'admin', 'invite');
update public.profiles set name = 'Mallory' where id = :'alice';
reset role;
\set ON_ERROR_STOP 1

-- Bob is removed centrally: the next sync drops him and his grants.
set role service_role;
select 'resync: ' || (public.team_sync(jsonb_build_object(
  'workspace', jsonb_build_object('id', :'ws', 'short_id', 'team0001', 'name', 'Team', 'owner_id', :'alice'),
  'members', jsonb_build_array(jsonb_build_object('user_id', :'alice', 'role', 'owner', 'joined_via', 'creator'))
)) ->> 'ok');
select 'member list: ' || string_agg(user_id::text || ' ' || status, ', ' order by user_id) from public.workspace_members;
reset role;
set role authenticated;
:as_bob;
select 'bob after removal: ' || count(*) from public.pages;
reset role;
select 'bob grants left: ' || count(*) from public.page_access where user_id = :'bob';

-- The guard: our tokens act only as a signed-in person.
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"authenticated","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}';
select 'guard, person: ok' from (select public.edgeknow_guard()) g;
set request.jwt.claims = '{"iss":"https://supabase.test/auth/v1","role":"service_role"}';
select 'guard, the project''s own secret key: ok' from (select public.edgeknow_guard()) g;
\set ON_ERROR_STOP 0
set request.jwt.claims = '{"iss":"https://wiki.test/oidc","role":"service_role"}';
select public.edgeknow_guard();
set request.jwt.claims = '{"iss":"https://wiki.test/oidc"}';
select public.edgeknow_guard();
\set ON_ERROR_STOP 1
reset request.jwt.claims;

-- What is left of the central schema here: nothing about sign-in, domains or Drive.
select 'central-only tables left: ' || count(*) from pg_tables where schemaname = 'public'
  and tablename in ('platform_settings', 'invitations', 'workspace_domains', 'drive_connections', 'workspace_data_backups', 'public_email_domains');
select 'profile columns: ' || string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles';

-- How full the project is: for the secret key only.
set role service_role;
select 'size keys: ' || string_agg(k, ', ' order by k) || ', database > 0: ' || ((public.edgeknow_database_size() ->> 'database_bytes')::bigint > 0)
  from jsonb_object_keys(public.edgeknow_database_size()) k;
reset role;
\set ON_ERROR_STOP 0
set role authenticated;
select public.edgeknow_database_size();
set role anon;
select public.edgeknow_database_size();
reset role;
\set ON_ERROR_STOP 1
