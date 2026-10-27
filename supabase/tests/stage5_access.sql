-- Stage 5 checks for page access: grants, roles, inheritance, restriction,
-- whole-workspace access, ownership transfer, former members, other workspaces.
-- Output is compared with stage5_access.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000005a1', 'alice@access.test', now(), '{"full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000005b1', 'bob@access.test', now(), '{"full_name":"Bob"}'),
 ('00000000-0000-0000-0000-0000000005c1', 'carol@access.test', now(), '{"full_name":"Carol"}'),
 ('00000000-0000-0000-0000-0000000005d1', 'dave@access.test', now(), '{"full_name":"Dave"}'),
 ('00000000-0000-0000-0000-0000000005e1', 'eve@other-access.test', now(), '{"full_name":"Eve"}');

\set alice '00000000-0000-0000-0000-0000000005a1'
\set bob '00000000-0000-0000-0000-0000000005b1'
\set carol '00000000-0000-0000-0000-0000000005c1'
\set dave '00000000-0000-0000-0000-0000000005d1'
\set eve '00000000-0000-0000-0000-0000000005e1'

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Access') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'access.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Parent') ->> 'id' as p \gset
select public.create_page(:'ws', :'p', 'Child') ->> 'id' as c \gset
select public.create_page(:'ws', :'c', 'Grandchild') ->> 'id' as g \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Other access') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- New pages are private to their owner.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob before sharing: ' || count(*) from public.pages where workspace_id = :'ws';

-- Alice shares the parent: bob reads, carol comments; subpages follow.
set request.jwt.claim.sub = :'alice';
select 'share viewer: ' || (public.set_page_member_role(:'p', :'bob', 'viewer'))::text;
select 'share commenter: ' || (public.set_page_member_role(:'p', :'carol', 'commenter'))::text;
select 'share child editor: ' || (public.set_page_member_role(:'c', :'dave', 'editor'))::text;
select 'invalid role: ' || (public.set_page_member_role(:'p', :'bob', 'owner'))::text;
select 'owner as member: ' || (public.set_page_member_role(:'p', :'alice', 'viewer'))::text;
select 'other workspace: ' || (public.set_page_member_role(:'p', :'eve', 'viewer'))::text;

set request.jwt.claim.sub = :'bob';
select 'bob roles: ' || string_agg(title || '=' || coalesce(my_role, '-'), ', ' order by title)
  from (select p.title, public.my_role(p) from public.pages p where workspace_id = :'ws') x;
select 'viewer saves: ' || (public.save_page_content(:'p', '[]', 1))::text;
select 'viewer renames: ' || (public.rename_page(:'c', 'x'))::text;
select 'viewer adds subpage: ' || (public.create_page(:'ws', :'p', 'Sub'))::text;
select 'viewer shares: ' || (public.set_page_member_role(:'p', :'dave', 'viewer'))::text;
select 'viewer trashes: ' || (public.trash_page(:'p'))::text;

set request.jwt.claim.sub = :'carol';
select 'carol role on grandchild: ' || public.effective_role(:'g');
select 'commenter saves: ' || (public.save_page_content(:'g', '[]', 1))::text;

-- Dave edits the child branch only and doesn't see the parent.
set request.jwt.claim.sub = :'dave';
select 'dave sees: ' || string_agg(title || '=' || public.effective_role(id), ', ' order by title)
  from public.pages where workspace_id = :'ws';
select 'editor saves: ' || (public.save_page_content(:'c', '[{"type":"paragraph"}]', 1) ->> 'ok');
select public.create_page(:'ws', :'c', 'Dave sub') ->> 'id' as s \gset
select 'editor shares: ' || (public.set_page_member_role(:'c', :'bob', 'editor'))::text;
select 'editor trashes: ' || (public.trash_page(:'c'))::text;
select 'editor restricts: ' || (public.set_page_inherit(:'c', false))::text;
set request.jwt.claim.sub = :'alice';
select 'alice on dave''s subpage: ' || public.effective_role(:'s');

-- Eve, in another workspace, sees nothing even by id.
set request.jwt.claim.sub = :'eve';
select 'eve sees pages: ' || count(*) from public.pages where id in (:'p', :'c', :'g');
select 'eve sees grants: ' || count(*) from public.page_access;
select 'eve role: ' || coalesce(public.effective_role(:'p'), 'null');
select 'eve sharing info: ' || (public.page_sharing(:'p'))::text;
reset role;

-- Grants are written only through the functions.
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = :'alice';
insert into public.page_access (workspace_id, page_id, user_id, role) values (:'ws', :'p', :'dave', 'editor');
update public.pages set workspace_role = 'editor' where id = :'p';
reset role;
\set ON_ERROR_STOP 1

-- Sharing info: everyone with a role sees who has access; only the owner gets members.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob sharing: ' || (x ->> 'my_role') || ', entries ' || jsonb_array_length(x -> 'entries')
  || ', members ' || jsonb_array_length(x -> 'members')
  from public.page_sharing(:'p') x;
select 'bob sees grants: ' || count(*) from public.page_access;
set request.jwt.claim.sub = :'alice';
select 'alice sharing on grandchild: ' || (
  select string_agg(e ->> 'name' || ':' || (e ->> 'role') || ':' || coalesce(e ->> 'inherited_title', 'own'), ', ' order by e ->> 'name')
  from jsonb_array_elements(x -> 'entries') e)
  || ', members ' || jsonb_array_length(x -> 'members')
  from public.page_sharing(:'g') x;

-- Whole workspace access.
select 'workspace viewer: ' || (public.set_page_workspace_role(:'p', 'viewer'))::text;
set request.jwt.claim.sub = :'dave';
select 'dave on parent now: ' || public.effective_role(:'p');
select 'dave on child (editor wins): ' || public.effective_role(:'c');
select 'shared with workspace: ' || string_agg(title || '=' || coalesce(public.shared_with_workspace(p), '-'), ', ' order by title)
  from public.pages p where workspace_id = :'ws';

-- Restricting the grandchild keeps everyone's access, then the owner narrows it.
set request.jwt.claim.sub = :'alice';
select 'restrict root page: ' || (public.set_page_inherit(:'p', false))::text;
select 'restrict: ' || (public.set_page_inherit(:'g', false))::text;
select 'copied grants: ' || string_agg(pr.email || '=' || a.role, ', ' order by pr.email)
  from public.page_access a join public.profiles pr on pr.id = a.user_id where a.page_id = :'g';
select 'copied workspace role: ' || coalesce(workspace_role, '-') from public.pages where id = :'g';
select 'remove bob: ' || (public.set_page_member_role(:'g', :'bob', null))::text;
select 'no workspace: ' || (public.set_page_workspace_role(:'g', null))::text;
set request.jwt.claim.sub = :'bob';
select 'bob after restriction: grandchild ' || coalesce(public.effective_role(:'g'), 'null')
  || ', child ' || public.effective_role(:'c');
set request.jwt.claim.sub = :'alice';
select 'parent share does not reach restricted: ' || (public.set_page_member_role(:'p', :'bob', 'editor') ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob on grandchild still: ' || coalesce(public.effective_role(:'g'), 'null');
set request.jwt.claim.sub = :'alice';
select 'inherit again: ' || (public.set_page_inherit(:'g', true))::text;
set request.jwt.claim.sub = :'bob';
select 'bob after inherit: ' || public.effective_role(:'g');

-- Ownership transfer: the old owner stays as an editor.
set request.jwt.claim.sub = :'bob';
select 'non-owner transfers: ' || (public.transfer_page_ownership(:'c', :'bob'))::text;
set request.jwt.claim.sub = :'alice';
select 'transfer to other workspace: ' || (public.transfer_page_ownership(:'c', :'eve'))::text;
select 'transfer: ' || (public.transfer_page_ownership(:'c', :'dave'))::text;
select 'alice on child: ' || public.effective_role(:'c');
set request.jwt.claim.sub = :'dave';
select 'dave on child: ' || public.effective_role(:'c');
select 'dave own grant gone: ' || count(*) from public.page_access where page_id = :'c' and user_id = auth.uid();

-- Dave leaves: his grants go, his pages wait for an admin to reassign them.
set request.jwt.claim.sub = :'alice';
select 'departed before: ' || (public.departed_page_owners(:'ws') -> 'owners')::text;
select 'remove dave: ' || (public.remove_member(:'ws', :'dave') ->> 'ok');
reset role;
select 'dave grants left: ' || count(*) from public.page_access where user_id = :'dave';
set role authenticated;
set request.jwt.claim.sub = :'dave';
select 'dave sees after leaving: ' || count(*) from public.pages where workspace_id = :'ws';
set request.jwt.claim.sub = :'carol';
select 'member lists departed: ' || (public.departed_page_owners(:'ws'))::text;
select 'member reassigns: ' || (public.reassign_member_pages(:'ws', :'dave', :'carol'))::text;
set request.jwt.claim.sub = :'alice';
select 'departed: ' || (public.departed_page_owners(:'ws') -> 'owners')::text;
select 'reassign active member: ' || (public.reassign_member_pages(:'ws', :'bob', :'carol'))::text;
select 'reassign to outsider: ' || (public.reassign_member_pages(:'ws', :'dave', :'eve'))::text;
select 'reassign: ' || (public.reassign_member_pages(:'ws', :'dave', :'carol'))::text;
set request.jwt.claim.sub = :'carol';
select 'carol now owns: ' || string_agg(title, ', ' order by title)
  from public.pages where workspace_id = :'ws' and public.effective_role(id) = 'owner';
reset role;
select 'audit: ' || string_agg(action || ' ' || details::text, '; ' order by id)
  from public.audit_log where workspace_id = :'ws' and (action = 'pages_reassigned' or details ->> 'attempted' = 'reassign_member_pages');
