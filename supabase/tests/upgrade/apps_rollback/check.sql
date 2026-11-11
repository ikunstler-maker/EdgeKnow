-- After the apps migration and its rollback: no trace, other objects as before.
\pset format unaligned
\pset tuples_only on
select 'helper gone: ' || not exists (select 1 from pg_proc where proname = 'app_data_ok');
select 'no apps allowed: ' || (pg_get_constraintdef((select oid from pg_constraint where conname = 'service_objects_service_check')) not like '%apps%');
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000062a1';
select 'table kept: ' || count(*) from public.service_objects where title = 'Old table';
select 'apps refused: ' || public.create_service_object((select id from public.workspaces where name = 'Upgrade apps'), 'apps', 'app', 'x', '{"url": "https://a.example.com"}')::text;
select 'saving works: ' || (public.save_service_object((select id from public.service_objects where title = 'Old table'), 'Old table', '{}', 1) ->> 'ok');
select 'owner manages: ' || public.service_object_role((select id from public.service_objects where title = 'Old table'));
reset role;
