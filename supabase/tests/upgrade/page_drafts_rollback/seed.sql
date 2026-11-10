-- Pages as they were before drafts: a workspace with a tree, a private page, one in the trash.
insert into auth.users (id, email, email_confirmed_at) values
 ('10000000-0000-0000-0000-0000000005a1', 'owner@upgrade-drafts.test', now()),
 ('10000000-0000-0000-0000-0000000005b1', 'member@upgrade-drafts.test', now());
update public.platform_settings set open_registration = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000005a1';
select public.create_workspace('Upgrade drafts') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'upgrade-drafts.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Handbook') ->> 'id' as handbook \gset
select public.set_page_workspace_role(:'handbook', 'viewer') ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'handbook', 'Chapter') ->> 'id' as chapter \gset
select public.create_page(:'ws', null, 'Private') ->> 'id' as private \gset
select public.set_page_workspace_role(:'private', null) ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Old') ->> 'id' as old \gset
select public.trash_page(:'old') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000005b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.pages set created_at = now() - interval '10 days' where title = 'Handbook';
