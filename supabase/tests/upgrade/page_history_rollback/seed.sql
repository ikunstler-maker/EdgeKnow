-- A page with text from before the history existed.
insert into auth.users (id, email, email_confirmed_at) values
 ('10000000-0000-0000-0000-0000000058a1', 'owner@upgrade-history.test', now());
update public.platform_settings set open_registration = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000058a1';
select public.create_workspace('Upgrade history') ->> 'id' as ws \gset
select public.create_page(:'ws', null, 'Old page') ->> 'id' as page \gset
select public.publish_page(:'page', false) ->> 'ok' as ignored \gset
select public.save_page_content(:'page', '[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Written before","styles":{}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
reset role;
