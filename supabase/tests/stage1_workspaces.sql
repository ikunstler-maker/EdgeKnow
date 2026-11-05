-- Workspace security checks: sign-in hook, joining, domains, members, invitations,
-- ownership, deletion, platform admin, and isolation between two workspaces.
-- Output is compared with stage1_workspaces.expected by scripts/test-db.sh.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001', 'owner@alpha.test', now()),
 ('00000000-0000-0000-0000-000000000002', 'admin@alpha.test', now()),
 ('00000000-0000-0000-0000-000000000003', 'member@alpha.test', now()),
 ('00000000-0000-0000-0000-000000000004', 'bob@beta.test', now()),
 ('00000000-0000-0000-0000-000000000005', 'guest@gmail.com', now()),
 ('00000000-0000-0000-0000-000000000006', 'stranger@other.test', now()),
 ('00000000-0000-0000-0000-000000000007', 'unverified@alpha.test', null);

-- Sign-in hook with no workspaces and registration closed: nobody gets in.
select 'hook alpha before: ' || (public.hook_before_user_created('{"user":{"email":"x@alpha.test"}}') ? 'error');

-- Creating a workspace needs access; open registration grants it.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'access closed: ' || public.has_platform_access();
select 'create closed: ' || (public.create_workspace('Alpha'))::text;
reset role;
update public.platform_settings set open_registration = true;
select 'hook anyone when open: ' || (public.hook_before_user_created('{"user":{"email":"x@whatever.test"}}') = '{}'::jsonb);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.create_workspace('Alpha') ->> 'id' as alpha \gset
select public.create_workspace('Alpha two') ->> 'id' as alpha2 \gset
select 'owner role: ' || public.workspace_role(:'alpha');
select 'bad name: ' || (public.create_workspace('   '))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select public.create_workspace('Beta') ->> 'id' as beta \gset
reset role;
update public.platform_settings set open_registration = false;

-- Domains: only your own email's domain, never a public one, never twice.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'add own domain: ' || (public.add_workspace_domain(:'alpha', 'Alpha.TEST'))::text;
select 'add other domain: ' || (public.add_workspace_domain(:'alpha', 'beta.test'))::text;
select 'add public domain: ' || (public.add_workspace_domain(:'alpha', 'gmail.com'))::text;
select 'add invalid: ' || (public.add_workspace_domain(:'alpha', 'not a domain'))::text;
select 'same domain twice: ' || (public.add_workspace_domain(:'alpha2', 'alpha.test'))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'bob adds own: ' || (public.add_workspace_domain(:'beta', 'beta.test'))::text;
reset role;

select 'hook alpha now: ' || (public.hook_before_user_created('{"user":{"email":"new@alpha.test"}}') = '{}'::jsonb);
select 'hook stranger: ' || (public.hook_before_user_created('{"user":{"email":"x@other.test"}}') ? 'error');

-- Joining by domain.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'member joins: ' || (public.join_workspaces() ->> 'ok');
select 'member role: ' || public.workspace_role(:'alpha');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'admin joins: ' || (public.join_workspaces() -> 'workspaces' ->> 0 is not null);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'promote admin: ' || (public.set_member_role(:'alpha', '00000000-0000-0000-0000-000000000002', 'admin'))::text;
select 'demote owner: ' || (public.set_member_role(:'alpha', '00000000-0000-0000-0000-000000000001', 'member'))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select 'stranger joins: ' || (public.join_workspaces())::text;
select 'stranger access: ' || public.has_platform_access();
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
select 'unverified joins: ' || (public.join_workspaces())::text;
reset role;

-- Plain members can't manage the workspace; attempts are logged.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'member adds domain: ' || (public.add_workspace_domain(:'alpha', 'alpha.test'))::text;
select 'member invites: ' || (public.invite_member(:'alpha', 'x@y.test', 'member'))::text;
select 'member sets role: ' || (public.set_member_role(:'alpha', '00000000-0000-0000-0000-000000000003', 'admin'))::text;
select 'member renames: ' || (public.rename_workspace(:'alpha', 'Mine'))::text;
select 'member sees members: ' || count(*) from public.workspace_members;
select 'member sees domains: ' || count(*) from public.workspace_domains;
select 'member sees log: ' || count(*) from public.audit_log;
reset role;
select 'denied attempts logged: ' || count(*) from public.audit_log where action = 'access_denied' and workspace_id = :'alpha';

-- Invitations: a gmail guest gets in only through a personal invitation.
select 'hook guest before invite: ' || (public.hook_before_user_created('{"user":{"email":"guest@gmail.com"}}') ? 'error');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.invite_member(:'alpha', 'Guest@Gmail.com', 'member') ->> 'token' as token \gset
select 'bad email: ' || (public.invite_member(:'alpha', 'nope', 'member'))::text;
select 'bad role: ' || (public.invite_member(:'alpha', 'a@b.test', 'owner'))::text;
select 'admin sees invitations: ' || count(*) from public.invitations;
reset role;
select 'hook guest after invite: ' || (public.hook_before_user_created('{"user":{"email":"guest@gmail.com"}}') = '{}'::jsonb);
set role anon;
select 'preview: ' || (public.invitation_preview(:'token') - 'workspace_short_id')::text;
select 'preview wrong token: ' || coalesce((public.invitation_preview('nope'))::text, 'null');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select 'guest joins: ' || (public.join_workspaces() ->> 'ok');
select 'guest role: ' || public.workspace_role(:'alpha');
select 'preview after accept: ' || (public.invitation_preview(:'token') ->> 'valid');
reset role;

-- Disabling a domain cuts off members who joined through it, right away.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'disable domain: ' || (public.set_workspace_domain_active(:'alpha', 'alpha.test', false))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'member after disable: ' || public.is_workspace_member(:'alpha') || ' / access ' || public.has_platform_access();
select 'member sees workspaces: ' || count(*) from public.workspaces;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select 'invited guest after disable: ' || public.is_workspace_member(:'alpha');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'owner after disable: ' || public.is_workspace_member(:'alpha');
select 'enable domain: ' || (public.set_workspace_domain_active(:'alpha', 'alpha.test', true))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'member after enable: ' || public.is_workspace_member(:'alpha');
reset role;

-- Last-admin guard: an owner who depends on the domain can't switch it off.
update public.workspace_members set joined_via = 'domain'
where workspace_id = :'alpha' and user_id = '00000000-0000-0000-0000-000000000001';
update public.workspace_members set role = 'member'
where workspace_id = :'alpha' and user_id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'disable last admin domain: ' || (public.set_workspace_domain_active(:'alpha', 'alpha.test', false))::text;
select 'remove last admin domain: ' || (public.remove_workspace_domain(:'alpha', 'alpha.test'))::text;
reset role;
update public.workspace_members set joined_via = 'creator'
where workspace_id = :'alpha' and user_id = '00000000-0000-0000-0000-000000000001';
update public.workspace_members set role = 'admin'
where workspace_id = :'alpha' and user_id = '00000000-0000-0000-0000-000000000002';

-- Removing a member: the domain doesn't bring them back; an invitation does.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'remove member: ' || (public.remove_member(:'alpha', '00000000-0000-0000-0000-000000000003'))::text;
select 'remove owner: ' || (public.remove_member(:'alpha', '00000000-0000-0000-0000-000000000001'))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'removed rejoins by domain: ' || (public.join_workspaces() -> 'workspaces')::text;
select 'removed is member: ' || public.is_workspace_member(:'alpha');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.invite_member(:'alpha', 'member@alpha.test', 'member') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'invited back joins: ' || (public.join_workspaces() ->> 'ok');
select 'invited back is member: ' || public.is_workspace_member(:'alpha');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select 'guest leaves: ' || (public.remove_member(:'alpha', '00000000-0000-0000-0000-000000000005'))::text;
select 'guest after leaving: ' || public.is_workspace_member(:'alpha');
reset role;

-- Isolation: Bob (Beta) sees nothing of Alpha, even by id.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.create_page(:'alpha', null, 'Alpha secret') ->> 'id' as alpha_page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'bob workspaces: ' || string_agg(name, ',') from public.workspaces;
select 'bob sees alpha by id: ' || count(*) from public.workspaces where id = :'alpha';
select 'bob members: ' || count(*) from public.workspace_members;
select 'bob domains: ' || string_agg(domain, ',') from public.workspace_domains;
select 'bob invitations: ' || count(*) from public.invitations;
select 'bob log rows of alpha: ' || count(*) from public.audit_log where workspace_id = :'alpha';
select 'bob profiles: ' || string_agg(email, ',') from public.profiles;
select 'bob pages: ' || count(*) from public.pages;
select 'bob alpha page by id: ' || count(*) from public.pages where id = :'alpha_page';
select 'bob role on alpha page: ' || coalesce(public.effective_role(:'alpha_page'), 'none');
select 'bob creates in alpha: ' || (public.create_page(:'alpha', null, 'x'))::text;
select 'bob renames alpha page: ' || (public.rename_page(:'alpha_page', 'x'))::text;
select 'bob invites to alpha: ' || (public.invite_member(:'alpha', 'bob@beta.test', 'admin'))::text;
select 'bob adds domain to alpha: ' || (public.add_workspace_domain(:'alpha', 'beta.test'))::text;
select 'bob deletes alpha: ' || (public.delete_workspace(:'alpha', 'Alpha'))::text;
select 'bob login hint alpha: ' || coalesce(public.workspace_login_hint((select short_id from public.workspaces where id = :'alpha')), 'null');
reset role;

-- Direct writes are blocked for everyone.
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
insert into public.workspace_members (workspace_id, user_id, joined_via) values (:'alpha', '00000000-0000-0000-0000-000000000004', 'invite');
update public.workspaces set name = 'hacked';
insert into public.audit_log (action) values ('fake');
update public.platform_settings set open_registration = true;
select public.log_workspace_action(:'alpha', 'fake', '{}');
reset role;
set role anon;
select count(*) from public.workspaces;
select public.has_platform_access();
reset role;
\set ON_ERROR_STOP 1

-- Platform admin: statistics of every workspace, but no page contents.
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-000000000004';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'stats: ' || string_agg(coalesce(name, '(hidden)') || '=' || members || 'm/' || pages || 'p', ',' order by created_at) from public.platform_workspaces();
select 'admin sees alpha pages: ' || count(*) from public.pages where workspace_id = :'alpha';
select 'admin reads platform log: ' || (count(*) > 0) from public.audit_log where workspace_id is null;
select 'open registration: ' || (public.set_open_registration(true))::text;
select 'close registration: ' || (public.set_open_registration(false))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'non-admin stats: ' || count(*) from public.platform_workspaces();
select 'non-admin registration: ' || (public.set_open_registration(true))::text;
reset role;

-- Ownership transfer, then deletion by the new owner with the name typed in.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'admin transfers: ' || (public.transfer_workspace_ownership(:'alpha', '00000000-0000-0000-0000-000000000002'))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'transfer to outsider: ' || (public.transfer_workspace_ownership(:'alpha', '00000000-0000-0000-0000-000000000004'))::text;
select 'transfer: ' || (public.transfer_workspace_ownership(:'alpha', '00000000-0000-0000-0000-000000000002'))::text;
select 'old owner role: ' || public.workspace_role(:'alpha');
select 'old owner deletes: ' || (public.delete_workspace(:'alpha', 'Alpha'))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'new owner role: ' || public.workspace_role(:'alpha');
select 'rename: ' || (public.rename_workspace(:'alpha', 'Alpha Team'))::text;
select 'delete wrong name: ' || (public.delete_workspace(:'alpha', 'Alpha'))::text;
select 'delete: ' || (public.delete_workspace(:'alpha', ' Alpha Team '))::text;
reset role;
select 'alpha left: ' || count(*) from public.workspaces where id = :'alpha';
select 'alpha pages left: ' || count(*) from public.pages where workspace_id = :'alpha';
select 'alpha members left: ' || count(*) from public.workspace_members where workspace_id = :'alpha';
select 'deletion logged: ' || count(*) from public.audit_log where workspace_id is null and action = 'workspace_deleted';
select 'workspaces now: ' || string_agg(name, ',' order by created_at) from public.workspaces;

-- Opening registration ended the instant (email) way of adding domains; later tests use it.
update public.platform_settings set email_domain_proof = true, require_team_database = false;
