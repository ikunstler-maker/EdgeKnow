-- Company apps (Obriy, step O-1) in a team database: only the owner and admins add and edit
-- apps, the link stays http(s), everyone else in the workspace only views them.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

select 'roles: ' || string_agg(role, ',' order by user_id) from public.workspace_members
where workspace_id = :'ws' and user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
set role authenticated;
:as_bob;
select 'member adds an app: ' || public.create_service_object(:'ws', 'apps', 'app', 'CRM', '{"url": "https://crm.example.com"}')::text;
reset role;
set role authenticated;
:as_alice;
select 'javascript link: ' || public.create_service_object(:'ws', 'apps', 'app', 'x', '{"url": "javascript:alert(1)"}')::text;
select public.create_service_object(:'ws', 'apps', 'app', 'CRM', '{"url": "https://crm.example.com", "category": "Sales"}') ->> 'id' as app \gset
select 'owner adds an app: ' || count(*) from public.service_objects where id = :'app';
select 'logo over 2 MB: ' || public.register_object_file(:'app', 'logo.png', 'image/png', 2097153)::text;
reset role;
set role authenticated;
:as_bob;
select 'member role: ' || public.service_object_role(:'app');
select 'member saves: ' || public.save_service_object(:'app', 'x', null, 1)::text;
reset role;
set role authenticated;
:as_alice;
select 'owner saves a javascript link: ' || public.save_service_object(:'app', null, '{"url": "javascript:x"}', 1)::text;
select 'owner deletes: ' || (public.trash_service_object(:'app', false) ->> 'ok') || ' ' || (public.delete_service_object_forever(:'app') ->> 'ok');
reset role;
