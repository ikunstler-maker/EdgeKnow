-- Before open registration: "own database first", freezing a workspace,
-- limits on making workspaces, and the central database size.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000017a1', 'frank@guard.test', now()),
 ('00000000-0000-0000-0000-0000000017b1', 'gina@guard.test', now()),
 ('00000000-0000-0000-0000-0000000017e1', 'admin@platform-guard.test', now());
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000017e1';

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017e1';
select 'admin turns it on: ' || public.set_require_team_database(true)::text;
select public.create_workspace('Admin own') ->> 'id' as adminws \gset
select 'admin''s workspace keeps the central database: ' || coalesce(public.create_page(:'adminws', null, 'Central') ->> 'ok', 'no');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
select 'frank turns it off: ' || public.set_require_team_database(false)::text;
select public.create_workspace('Frank team') ->> 'id' as ws \gset
select 'frank''s first page: ' || public.create_page(:'ws', null, 'First')::text;
select 'frank allows himself: ' || public.platform_set_central_allowed(:'ws', true)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017e1';
select 'admin allows it: ' || public.platform_set_central_allowed(:'ws', true)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
select public.create_page(:'ws', null, 'Now allowed') ->> 'id' as page \gset
select 'frank''s page after: ' || (:'page' is not null);
select public.invite_member(:'ws', 'gina@guard.test', 'member') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
select 'gina is a member: ' || public.is_workspace_member(:'ws');
select short_id as wsshort from public.workspaces where id = :'ws' \gset

-- Freezing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
select 'frank freezes: ' || public.platform_freeze_workspace(:'ws', true, 'x')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017e1';
select 'admin freezes: ' || public.platform_freeze_workspace(:'ws', true, 'Spam reported')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017b1';
select 'gina while frozen: ' || public.is_workspace_member(:'ws') || ', pages seen: ' || (select count(*) from public.pages where workspace_id = :'ws');
select 'gina is told: ' || (public.frozen_workspace_notice(:'wsshort') - 'frozen_at')::text;
select 'gina can''t write: ' || public.create_page(:'ws', null, 'During')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017e1';
select 'a stranger is told nothing: ' || coalesce(public.frozen_workspace_notice(:'wsshort')::text, 'null');
select 'platform list: ' || (select (data_location is null) || ' ' || central_allowed || ' ' || (frozen_at is not null) || ' ' || frozen_reason from public.platform_workspaces() where id = :'ws');
select 'unfreeze: ' || public.platform_freeze_workspace(:'ws', false, null)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017b1';
select 'gina after: ' || public.is_workspace_member(:'ws');

-- Making workspaces: five a day.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
select string_agg(coalesce(public.create_workspace('Frank ' || n) ->> 'error', 'ok'), ', ' order by n) as made from generate_series(2, 6) n \gset
select 'frank makes more: ' || :'made';

-- The central database size, for the platform admin only.
select 'frank sees the size: ' || coalesce(public.platform_database_size()::text, 'null');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017e1';
select 'admin sees the size: ' || ((public.platform_database_size() ->> 'database_bytes')::bigint > 0);
-- Opening registration turns "own database first" on.
select public.set_require_team_database(false) ->> 'ok' as ignored \gset
select public.set_open_registration(true) ->> 'ok' as ignored \gset
reset role;
select 'after opening: ' || require_team_database from public.platform_settings;

\set ON_ERROR_STOP 0
set role anon;
select public.platform_freeze_workspace(:'ws', true, 'x');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000017a1';
update public.workspaces set frozen_at = null, central_allowed = true where id = :'ws';
reset role;
\set ON_ERROR_STOP 1

update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;
delete from public.pages where workspace_id in (:'ws', :'adminws');
