-- Faster reads: my_page_tree() must answer exactly what reading public.pages with
-- its computed columns answers, for every kind of person (owner, member, someone
-- in a unit, a unit lead above, a guest, an outsider); workspace_context() must
-- answer what public.workspaces + workspace_role() answer.
\pset format unaligned
\pset tuples_only on

-- Pages in this file are published when created; drafts have their own test (page drafts).
alter table public.pages alter column published_at set default now();
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000051a1', 'alice@fast.test', now()),
 ('00000000-0000-0000-0000-0000000051b1', 'bob@fast.test', now()),
 ('00000000-0000-0000-0000-0000000051c1', 'carol@fast.test', now()),
 ('00000000-0000-0000-0000-0000000051d1', 'dave@fast.test', now()),
 ('00000000-0000-0000-0000-0000000051e1', 'gwen@client-fast.test', now()),
 ('00000000-0000-0000-0000-0000000051f1', 'zed@elsewhere-fast.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select public.create_workspace('Fast') ->> 'id' as ws \gset
select short_id as short from public.workspaces where id = :'ws' \gset
select public.add_workspace_domain(:'ws', 'fast.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051f1';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select public.invite_member(:'ws', 'gwen@client-fast.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051e1';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Units: Company > Marketing > Design. Bob is in Design, Carol leads Marketing, Dave is in no unit.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select public.create_workspace_group(:'ws', 'Company') ->> 'id' as company \gset
select public.create_workspace_group(:'ws', 'Marketing', :'company') ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design', :'marketing') ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'design', '00000000-0000-0000-0000-0000000051b1', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'marketing', '00000000-0000-0000-0000-0000000051c1', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'marketing', '00000000-0000-0000-0000-0000000051c1', true) ->> 'ok' as ignored \gset

-- Pages of every kind.
select public.create_page(:'ws', null, 'Open to all') ->> 'id' as open_page \gset
select public.set_page_workspace_role(:'open_page', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'open_page', 'Inherits open') ->> 'id' as open_child \gset
select public.create_page(:'ws', :'open_child', 'Deep under open') ->> 'id' as open_deep \gset
select public.create_page(:'ws', null, 'Viewers only') ->> 'id' as view_page \gset
select public.set_page_workspace_role(:'view_page', 'viewer') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Closed') ->> 'id' as closed_page \gset
select public.set_page_workspace_role(:'closed_page', null) ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'closed_page', 'Under closed') ->> 'id' as closed_child \gset
select public.create_page(:'ws', null, 'For Design') ->> 'id' as design_page \gset
select public.set_page_workspace_role(:'design_page', null) ->> 'ok' as ignored \gset
select public.set_page_group_role(:'design_page', :'design', 'commenter') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'For Dave') ->> 'id' as dave_page \gset
select public.set_page_workspace_role(:'dave_page', null) ->> 'ok' as ignored \gset
select public.set_page_member_role(:'dave_page', '00000000-0000-0000-0000-0000000051d1', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'For the guest') ->> 'id' as guest_page \gset
select public.set_page_workspace_role(:'guest_page', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_member_role(:'guest_page', '00000000-0000-0000-0000-0000000051e1', 'commenter') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'In the trash') ->> 'id' as trashed \gset
select public.set_page_workspace_role(:'trashed', 'editor') ->> 'ok' as ignored \gset
select public.trash_page(:'trashed') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Confirmed') ->> 'id' as ack_page \gset
select public.set_page_workspace_role(:'ack_page', 'viewer') ->> 'ok' as ignored \gset
select public.set_page_ack(:'ack_page', 'read', '{}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051b1';
select public.create_page(:'ws', null, 'Bob''s own') ->> 'id' as bob_page \gset
select public.set_page_workspace_role(:'bob_page', null) ->> 'ok' as ignored \gset

-- The old way (rows through the table's rule, with its computed columns) against the new one.
\set old 'select p.id, p.parent_id, p.title, p.icon, p.position, p.owner_id, public.my_role(p) as my_role, public.shared_with_workspace(p) as shared_with_workspace, p.ack_label, public.is_draft(p) as draft from public.pages p where p.workspace_id = :''ws'' and p.deleted_at is null'
\set new 'select * from public.my_page_tree(:''ws'')'
\set compare 'select (select count(*) from (:old) o) || '' pages, '' || (select count(*) from ((:old) except (:new)) d) || '' only the old way, '' || (select count(*) from ((:new) except (:old)) d) || '' only the new way'''
\set context 'select coalesce((select public.workspace_context(:''short'') - ''joined_at'' - ''id'' - ''short_id'')::text, ''nothing'') || '' / old: '' || coalesce((select w.name || '' '' || public.workspace_role(w.id) from public.workspaces w where w.short_id = :''short''), ''nothing'')'

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select 'owner: ' || (:compare);
select 'owner roles: ' || string_agg(title || '=' || my_role || '/' || coalesce(shared_with_workspace, '-') || '/' || coalesce(ack_label, '-'), ', ' order by title) from public.my_page_tree(:'ws');
select 'owner context: ' || (:context);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051b1';
select 'bob (in Design): ' || (:compare);
select 'bob roles: ' || string_agg(title || '=' || my_role, ', ' order by title) from public.my_page_tree(:'ws');
select 'bob context: ' || (:context);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051c1';
select 'carol (leads Marketing, above Design): ' || (:compare);
select 'carol roles: ' || string_agg(title || '=' || my_role, ', ' order by title) from public.my_page_tree(:'ws');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051d1';
select 'dave (no unit): ' || (:compare);
select 'dave roles: ' || string_agg(title || '=' || my_role, ', ' order by title) from public.my_page_tree(:'ws');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051e1';
select 'gwen (guest): ' || (:compare);
select 'gwen roles: ' || coalesce(string_agg(title || '=' || my_role, ', ' order by title), 'none') from public.my_page_tree(:'ws');
select 'gwen context: ' || (:context);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051f1';
select 'zed (another workspace): ' || (:compare);
select 'zed sees through the new way: ' || (select count(*) from public.my_page_tree(:'ws'));
select 'zed context: ' || (:context);
select 'zed asks for his own workspace''s tree: ' || (select count(*) from public.my_page_tree(:'other'));
select 'a wrong short id: ' || coalesce(public.workspace_context('nope')::text, 'nothing');

-- A custom role caps what "the whole workspace" gives: Dave becomes an intern (viewer at most).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select public.save_workspace_role(:'ws', null, 'Intern', '{}', 'viewer') ->> 'id' as intern \gset
select public.set_member_custom_role(:'ws', '00000000-0000-0000-0000-0000000051d1', :'intern') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051d1';
select 'dave as an intern: ' || (:compare);
select 'dave roles as an intern: ' || string_agg(title || '=' || my_role, ', ' order by title) from public.my_page_tree(:'ws');

-- The order is the tree's order.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select 'ordered by position: ' || (select bool_and(position >= prev) from (select position, lag(position, 1, position) over () as prev from public.my_page_tree(:'ws')) x);

-- A frozen workspace answers nothing, either way; a guest past the date too.
reset role;
update public.workspace_members set access_until = now() - interval '1 day' where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-0000000051e1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051e1';
select 'gwen past her date: ' || (:compare) || ', context: ' || coalesce((public.workspace_context(:'short') ->> 'role'), 'nothing');
reset role;
update public.workspaces set frozen_at = now() where id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000051a1';
select 'frozen workspace, owner: ' || (:compare) || ', context: ' || coalesce((public.workspace_context(:'short') ->> 'role'), 'nothing');
reset role;

-- Nobody without a sign-in may call them.
select 'anon may call my_page_tree: ' || has_function_privilege('anon', 'public.my_page_tree(uuid)', 'execute') || ', workspace_context: ' || has_function_privilege('anon', 'public.workspace_context(text)', 'execute');

reset role;
alter table public.pages alter column published_at drop default;
