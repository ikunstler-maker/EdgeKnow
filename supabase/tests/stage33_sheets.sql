-- Tables (step Т1): an object of the service "sheets" (kind "sheet"); anyone in
-- the workspace makes one (a guest's belongs to the workspace owner); access and
-- versions as for boards; search reads the cells' shown text and sheet names.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000033a1', 'alice@sheets.test', now()),
 ('00000000-0000-0000-0000-0000000033b1', 'bob@sheets.test', now()),
 ('00000000-0000-0000-0000-0000000033c1', 'carol@other-sheets.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000033a1';
select public.create_workspace('Sheets') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'sheets.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000033b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000033c1';
select public.create_workspace('Other sheets') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000033b1';
select public.create_service_object(:'ws', 'sheets', 'sheet', 'Budget', '{"sheets": [{"name": "Q1", "celldata": [{"r": 0, "c": 0, "v": {"v": "Rent", "m": "Rent"}}, {"r": 0, "c": 1, "v": {"v": 1200, "m": "1 200,00 ₴", "f": "=1000+200"}}]}]}') as made \gset
select 'bob makes a table: ' || (:'made'::jsonb ->> 'ok');
select (:'made'::jsonb ->> 'id') as sheet \gset
select 'a table of another kind: ' || public.create_service_object(:'ws', 'sheets', 'board', 'x', '{}')::text;
select 'text for search: ' || search_text from public.service_objects where id = :'sheet';
select 'save: ' || (public.save_service_object(:'sheet', 'Budget 2027', '{"sheets": [{"name": "Q2", "celldata": []}]}', 1) ->> 'version');
select 'stale save: ' || public.save_service_object(:'sheet', null, '{"sheets": []}', 1)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000033c1';
select 'outsider sees: ' || count(*) from public.service_objects where service = 'sheets';
select 'outsider makes one in the workspace: ' || public.create_service_object(:'ws', 'sheets', 'sheet', 'x', '{}')::text;
select 'outsider saves: ' || public.save_service_object(:'sheet', 'x', null, 2)::text;
reset role;
delete from public.workspaces where name in ('Sheets', 'Other sheets');
delete from auth.users where email in ('alice@sheets.test', 'bob@sheets.test', 'carol@other-sheets.test');
