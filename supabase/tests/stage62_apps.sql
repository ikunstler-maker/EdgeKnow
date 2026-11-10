-- Company apps (Obriy, step O-1): an object of the service "apps" (kind "app") with a
-- link (http/https only), a logo, a category and a description. Only the workspace's owner
-- and admins add, edit, share and delete apps; everyone else at most views them; guests and
-- outsiders see none unless shared; a logo picture is 2 MB at most.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000062a1', 'alice@apps.test', now()),
 ('00000000-0000-0000-0000-0000000062b1', 'bob@apps.test', now()),
 ('00000000-0000-0000-0000-0000000062c1', 'carol@apps.test', now()),
 ('00000000-0000-0000-0000-0000000062e1', 'erin@apps.test', now()),
 ('00000000-0000-0000-0000-0000000062d1', 'dan@other-apps.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062a1';
select public.create_workspace('Apps') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'apps.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062e1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062d1';
select public.create_workspace('Other apps') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062a1';
select 'carol made admin: ' || (public.set_member_role(:'ws', '00000000-0000-0000-0000-0000000062c1', 'admin') ->> 'ok');
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;
-- Erin becomes a guest.
update public.workspace_members set role = 'guest' where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-0000000062e1';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062b1';
select 'member adds an app: ' || public.create_service_object(:'ws', 'apps', 'app', 'CRM', '{"url": "https://crm.example.com"}')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062e1';
select 'guest adds an app: ' || public.create_service_object(:'ws', 'apps', 'app', 'CRM', '{"url": "https://crm.example.com"}')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062a1';
select 'javascript link: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "javascript:alert(1)"}')::text;
select 'data link: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "data:text/html,hi"}')::text;
select 'no link: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{}')::text;
select 'link with a space: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "https://a.example.com/ x"}')::text;
select 'javascript logo: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "https://a.example.com", "logo": "javascript:x"}')::text;
select 'plain http logo: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "https://a.example.com", "logo": "http://a.example.com/i.png"}')::text;
select 'long category: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', jsonb_build_object('url', 'https://a.example.com', 'category', repeat('c', 61)))::text;
select 'wrong kind: ' || public.create_service_object(:'ws', 'apps', 'sheet', 'x', '{"url": "https://a.example.com"}')::text;
select public.create_service_object(:'ws', 'apps', 'app', 'CRM', '{"url": "https://crm.example.com", "logo": "https://crm.example.com/logo.png", "category": "Sales", "description": "Clients and deals"}') as made \gset
select 'owner adds an app: ' || (:'made'::jsonb ->> 'ok');
select (:'made'::jsonb ->> 'id') as app \gset
select 'plain http link: ' || (public.create_service_object(:'ws', 'apps', 'app', 'Old', '{"url": "http://old.example.com"}') ->> 'ok');
select 'whole workspace views: ' || workspace_role from public.service_objects where id = :'app';
select 'text for search: ' || search_text from public.service_objects where id = :'app';

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062b1';
select 'member sees: ' || count(*) from public.service_objects where service = 'apps';
select 'member role: ' || public.service_object_role(:'app');
select 'member saves: ' || public.save_service_object(:'app', 'x', null, 1)::text;
select 'member trashes: ' || public.trash_service_object(:'app', false)::text;
select 'member shares: ' || public.set_service_object_workspace_role(:'app', 'editor')::text;
select 'member adds a logo: ' || public.register_object_file(:'app', 'logo.png', 'image/png', 1000)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062e1';
select 'guest sees: ' || count(*) from public.service_objects where service = 'apps';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062d1';
select 'outsider sees: ' || count(*) from public.service_objects where service = 'apps';
select 'outsider role: ' || coalesce(public.service_object_role(:'app'), 'none');

-- Even a member given "editor" or "owner" on an app only views it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062a1';
select 'owner gives bob owner: ' || (public.set_service_object_member_role(:'app', '00000000-0000-0000-0000-0000000062b1', 'owner') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062b1';
select 'bob still views: ' || public.service_object_role(:'app');
select 'bob saves: ' || public.save_service_object(:'app', 'x', null, 1)::text;

-- An admin manages apps; the link stays http(s).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062c1';
select 'admin role: ' || public.service_object_role(:'app');
select 'admin saves: ' || (public.save_service_object(:'app', 'CRM 2', '{"url": "https://crm2.example.com", "category": "Sales", "description": "New"}', 1) ->> 'version');
select 'admin saves a javascript link: ' || public.save_service_object(:'app', null, '{"url": "JavaScript:alert(1)"}', 2)::text;
select 'admin renames only: ' || (public.save_service_object(:'app', 'CRM 3', null, 2) ->> 'ok');
select 'logo over 2 MB: ' || public.register_object_file(:'app', 'logo.png', 'image/png', 2097153)::text;
select 'logo not a picture: ' || public.register_object_file(:'app', 'logo.svg', 'image/svg+xml', 1000)::text;
select 'logo 2 MB: ' || (public.register_object_file(:'app', 'logo.png', 'image/png', 2097152) ->> 'ok');
select 'logo file id kept: ' || (public.save_service_object(:'app', null, jsonb_build_object('url', 'https://crm2.example.com', 'logoFile', (select id from public.object_files where object_id = :'app')), 3) ->> 'ok');

-- Shared with no one: the member no longer sees it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062a1';
select 'owner removes bob: ' || (public.set_service_object_member_role(:'app', '00000000-0000-0000-0000-0000000062b1', null) ->> 'ok');
select 'only chosen people: ' || (public.set_service_object_workspace_role(:'app', null) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062b1';
select 'member sees now: ' || count(*) from public.service_objects where id = :'app';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000062c1';
select 'admin to the bin: ' || (public.trash_service_object(:'app', false) ->> 'ok');
select 'admin deletes: ' || (public.delete_service_object_forever(:'app') ->> 'ok');
select 'helper closed to clients: ' || has_function_privilege('public.app_data_ok(jsonb)', 'execute');
reset role;
delete from public.workspaces where name in ('Apps', 'Other apps');
delete from auth.users where email like '%apps.test';
