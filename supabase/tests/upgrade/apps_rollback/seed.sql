-- A workspace with a table from before company apps existed.
insert into auth.users (id, email, email_confirmed_at) values
 ('10000000-0000-0000-0000-0000000062a1', 'owner@upgrade-apps.test', now());
update public.platform_settings set open_registration = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000062a1';
select public.create_workspace('Upgrade apps') ->> 'id' as ws \gset
select public.create_service_object(:'ws', 'sheets', 'sheet', 'Old table', '{}') ->> 'ok' as ignored \gset
reset role;
