-- Company structure, stage 2: roles with own names. Only the owner manages them; a
-- role takes rights away (pages) or gives them (projects, structure, inviting), and caps
-- what is open to the whole workspace; personal grants still count; members without a
-- custom role and guests behave as before.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000046a1', 'alice@roles.test', now()),
 ('00000000-0000-0000-0000-0000000046b1', 'bob@roles.test', now()),
 ('00000000-0000-0000-0000-0000000046c1', 'carol@roles.test', now()),
 ('00000000-0000-0000-0000-0000000046d1', 'dave@roles.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046a1';
select public.create_workspace('Roles') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'roles.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Open to all') ->> 'id' as open_page \gset
select public.set_page_workspace_role(:'open_page', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Shared with bob') ->> 'id' as bob_page \gset
select public.set_page_workspace_role(:'bob_page', 'editor') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
select 'built-in roles: ' || string_agg(builtin || '=' || name, ', ' order by position) from public.workspace_roles where workspace_id = :'ws';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046a1';
select public.set_page_member_role(:'bob_page', '00000000-0000-0000-0000-0000000046b1', 'editor') ->> 'ok' as ignored \gset
select public.save_workspace_role(:'ws', null, 'Intern', '{"create_pages": false, "bogus": true}', 'viewer') ->> 'id' as intern \gset
select public.save_workspace_role(:'ws', null, 'Lead', '{"create_projects": true, "manage_structure": true, "invite": true}', null) ->> 'id' as lead \gset
select 'kept rights: ' || permissions::text from public.workspace_roles where id = :'intern';
select 'bad level: ' || public.save_workspace_role(:'ws', null, 'X', '{}', 'owner')::text;
select 'bob intern: ' || (public.set_member_custom_role(:'ws', '00000000-0000-0000-0000-0000000046b1', :'intern') ->> 'ok');
select 'carol lead: ' || (public.set_member_custom_role(:'ws', '00000000-0000-0000-0000-0000000046c1', :'lead') ->> 'ok');
select 'owner as intern: ' || public.set_member_custom_role(:'ws', '00000000-0000-0000-0000-0000000046a1', :'intern')::text;

-- Bob (Intern): no new pages, only reads what is open to all, still edits what is his personally.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046b1';
select 'intern makes a page: ' || public.create_page(:'ws', null, 'Mine')::text;
select 'intern on open page: ' || (select public.my_role(p) from public.pages p where p.id = :'open_page');
select 'intern on own grant: ' || (select public.my_role(p) from public.pages p where p.id = :'bob_page');
select 'intern makes a role: ' || public.save_workspace_role(:'ws', null, 'Boss', '{}', null)::text;
select 'intern sets a role: ' || public.set_member_custom_role(:'ws', '00000000-0000-0000-0000-0000000046b1', null)::text;

-- Carol (Lead): projects, structure and invitations, but never an admin invitation.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046c1';
select 'lead makes a project: ' || (public.create_task_project(:'ws', 'Ops', 'OPS', null, null) ->> 'ok');
select 'lead makes a unit: ' || (public.create_workspace_group(:'ws', 'Ops team') ->> 'ok');
select 'lead invites a member: ' || (public.invite_member(:'ws', 'new@roles.test', 'member') ->> 'ok');
select 'lead invites an admin: ' || public.invite_member(:'ws', 'boss@roles.test', 'admin')::text;
select 'lead on open page: ' || (select public.my_role(p) from public.pages p where p.id = :'open_page');

-- Dave (plain member): as before.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046d1';
select 'member makes a page: ' || (public.create_page(:'ws', null, 'Dave notes') ->> 'ok');
select 'member makes a project: ' || public.create_task_project(:'ws', 'Mine', 'MIN', null, null)::text;
select 'member makes a unit: ' || public.create_workspace_group(:'ws', 'Daves')::text;
select 'member on open page: ' || (select public.my_role(p) from public.pages p where p.id = :'open_page');
\set ON_ERROR_STOP 0
insert into public.workspace_roles (workspace_id, name) values (:'ws', 'direct');
\set ON_ERROR_STOP 1

-- The owner limits plain members too, then removes Intern: Bob is a plain member again.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046a1';
select 'members capped: ' || (public.save_workspace_role(:'ws', (select id from public.workspace_roles where workspace_id = :'ws' and builtin = 'member'), 'Співробітник', '{"create_pages": true}', 'commenter') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046d1';
select 'member on open page now: ' || (select public.my_role(p) from public.pages p where p.id = :'open_page');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000046a1';
select 'built-in cannot go: ' || public.delete_workspace_role(:'ws', (select id from public.workspace_roles where workspace_id = :'ws' and builtin = 'member'))::text;
select 'delete intern: ' || (public.delete_workspace_role(:'ws', :'intern') ->> 'ok');
select 'bob role now: ' || coalesce((select custom_role_id::text from public.workspace_members where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-0000000046b1'), 'built-in');
reset role;
select 'team copy has roles: ' || jsonb_array_length(public.team_sync_payload(:'ws') -> 'roles');
