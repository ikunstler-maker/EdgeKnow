-- VAULT-7 in a team database: the owner's switch, members read it, links take no space
-- and leave the Drive's file alone.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

select user_id as owner_id from public.workspace_members where workspace_id = :'ws' and role = 'owner' and status = 'active' limit 1 \gset
select 'bob is: ' || role from public.workspace_members where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-0000000000b1';

set role authenticated;
:as_bob;
select 'bob (not the owner) switches: ' || (public.set_vault_drive_browse(:'ws', false) ->> 'error');
select public.begin_vault_link(:'ws', null, 'team video.mp4', 'video/mp4', 8000000000) ->> 'id' as link \gset
reset role;
update public.vault_items set storage_backend = 'drive_link', drive_source = 'wiki', drive_account_id = gen_random_uuid(), drive_file_id = 'drive-team-video' where id = :'link';
set role authenticated;
:as_bob;
select 'listed as a link: ' || (select string_agg((i ->> 'name') || ' ' || (i ->> 'link'), ', ') from jsonb_array_elements(public.vault_list(:'ws', null) -> 'items') i where i ->> 'name' = 'team video.mp4');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_id', false) as ignored \gset
select set_config('request.jwt.claims', json_build_object('iss', 'https://wiki.test/oidc', 'role', 'authenticated', 'sub', :'owner_id', 'ek_workspace', :'ws')::text, false) as ignored \gset
select 'the owner turns it off: ' || (public.set_vault_drive_browse(:'ws', false) ->> 'ok');
:as_bob;
select 'bob reads the switch: ' || (select drive_browse from public.vault_settings where workspace_id = :'ws');
select 'bob starts a link while off: ' || (public.begin_vault_link(:'ws', null, 'x.pdf', 'application/pdf', 10) ->> 'error');
reset role;
delete from public.vault_items where id = :'link';
select 'tombstones for it: ' || (select count(*) from public.attachment_tombstones where drive_file_id = 'drive-team-video');
