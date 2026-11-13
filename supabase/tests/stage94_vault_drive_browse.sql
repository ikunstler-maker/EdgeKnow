-- VAULT-7: the team's Drive in Vault — the owner's switch, links (no copy, no space,
-- no versions, the Drive's file never deleted with the link), the list marks links.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000094a1', 'alice@vaultbrowse.test', now()),
 ('00000000-0000-0000-0000-0000000094b1', 'bob@vaultbrowse.test', now()),
 ('00000000-0000-0000-0000-0000000094e1', 'gwen@vaultbrowse.test', now());
\set alice '00000000-0000-0000-0000-0000000094a1'
\set bob '00000000-0000-0000-0000-0000000094b1'
\set gwen '00000000-0000-0000-0000-0000000094e1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Vault browse') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'vaultbrowse.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.workspace_members set role = 'admin' where workspace_id = :'ws' and user_id = :'bob';
update public.workspace_members set role = 'guest' where workspace_id = :'ws' and user_id = :'gwen';
set role authenticated;

-- The switch: on by default; the owner only (not an admin).
set request.jwt.claim.sub = :'bob';
select 'admin turns it off: ' || (public.set_vault_drive_browse(:'ws', false) ->> 'error');
select 'bob starts a link (on by default): ' || (public.begin_vault_link(:'ws', null, 'plan.pdf', 'application/pdf', 9000000) ->> 'ok');
set request.jwt.claim.sub = :'gwen';
select 'a guest starts a link: ' || (public.begin_vault_link(:'ws', null, 'x.pdf', 'application/pdf', 10) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'owner turns it off: ' || (public.set_vault_drive_browse(:'ws', false) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'off: ' || (public.begin_vault_link(:'ws', null, 'plan.pdf', 'application/pdf', 10) ->> 'error');
select 'members read it: ' || (select drive_browse from public.vault_settings where workspace_id = :'ws');
set request.jwt.claim.sub = :'alice';
select 'owner turns it on: ' || (public.set_vault_drive_browse(:'ws', true) ->> 'ok');

-- The server points the record at the Drive's file.
set request.jwt.claim.sub = :'bob';
select public.begin_vault_link(:'ws', null, 'Big video.mp4', 'video/mp4', 9000000000) ->> 'id' as link \gset
select 'large, no limit of ours: ' || (select large from public.vault_items where id = :'link');
reset role;
\set ON_ERROR_STOP 0
update public.vault_items set storage_backend = 'drive_link' where id = :'link';
\set ON_ERROR_STOP 1
update public.vault_items set storage_backend = 'drive_link', drive_source = 'wiki', drive_account_id = gen_random_uuid(), drive_file_id = 'drive-video' where id = :'link';
select 'takes no space: ' || public.workspace_storage_used(:'ws');

set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'listed as a link: ' || (select string_agg((i ->> 'name') || ' ' || (i ->> 'link'), ', ') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') i);
select 'usage of files: ' || coalesce(public.vault_storage_usage(:'ws') #>> '{services,files,bytes}', 'none');
\set ON_ERROR_STOP 0
select 'a new version of a link: ' || (public.begin_vault_version(:'link', 'v2.mp4', 'video/mp4', 10) ->> 'ok');
\set ON_ERROR_STOP 1

-- Removed for good: the Drive's file stays (no tombstone).
reset role;
delete from public.vault_items where id = :'link';
select 'tombstones for it: ' || (select count(*) from public.attachment_tombstones where drive_file_id = 'drive-video');
select 'browse permission by default: ' || (select column_default from information_schema.columns where table_name = 'drive_connections' and column_name = 'can_browse');
