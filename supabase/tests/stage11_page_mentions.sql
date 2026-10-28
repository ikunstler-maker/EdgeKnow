-- Person chips in a page's text: listed for the mentioned person only, only while
-- they can see the page, and dropped when removed from the text.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000011a1', 'alice@mention.test', now()),
 ('00000000-0000-0000-0000-0000000011b1', 'bob@mention.test', now()),
 ('00000000-0000-0000-0000-0000000011c1', 'carol@mention.test', now()),
 ('00000000-0000-0000-0000-0000000011e1', 'eve@other-mention.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011a1';
select public.create_workspace('Mentions') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'mention.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Mentioning') ->> 'id' as page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011e1';
select public.create_workspace('Other mentions') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011a1';
select public.set_page_member_role(:'page', '00000000-0000-0000-0000-0000000011b1', 'viewer') ->> 'ok' as ignored \gset
-- Bob (can see), Carol (can't see the page), Eve (another workspace), Alice herself.
select public.save_page_content(:'page', '[{"id":"p1","type":"paragraph","props":{},"content":[
  {"type":"personChip","props":{"userId":"00000000-0000-0000-0000-0000000011b1","label":"Bob"}},
  {"type":"personChip","props":{"userId":"00000000-0000-0000-0000-0000000011c1","label":"Carol"}},
  {"type":"personChip","props":{"userId":"00000000-0000-0000-0000-0000000011e1","label":"Eve"}},
  {"type":"personChip","props":{"userId":"00000000-0000-0000-0000-0000000011a1","label":"Alice"}},
  {"type":"personChip","props":{"userId":"not-a-uuid","label":"X"}}],"children":[]}]', 1) ->> 'ok' as ignored \gset
reset role;
select 'stored: ' || string_agg(p.email, ', ' order by p.email) from public.page_mentions m join public.profiles p on p.id = m.user_id where m.page_id = :'page';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011b1';
select 'bob sees: ' || count(*) from public.page_mentions;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011c1';
select 'carol sees: ' || count(*) from public.page_mentions;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011a1';
select 'alice sees others'' mentions: ' || count(*) from public.page_mentions;
-- Bob removed from the text: off the list.
select public.save_page_content(:'page', '[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"nobody","styles":{}}],"children":[]}]', 2) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011b1';
select 'bob after removal: ' || count(*) from public.page_mentions;
reset role;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000011b1';
insert into public.page_mentions (workspace_id, page_id, user_id) values (:'ws', :'page', '00000000-0000-0000-0000-0000000011b1');
reset role;
\set ON_ERROR_STOP 1
