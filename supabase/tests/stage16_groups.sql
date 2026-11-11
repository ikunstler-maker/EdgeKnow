-- Groups: only admins manage them, a group's role reaches its members and the
-- subpages, leaving the group or the workspace takes it away, and nothing of a
-- group crosses into another workspace.
\pset format unaligned
\pset tuples_only on

-- Pages in this file are published when created; drafts have their own test (page drafts).
alter table public.pages alter column published_at set default now();
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000016a1', 'alice@grp.test', now()),
 ('00000000-0000-0000-0000-0000000016b1', 'bob@grp.test', now()),
 ('00000000-0000-0000-0000-0000000016c1', 'carol@grp.test', now()),
 ('00000000-0000-0000-0000-0000000016d1', 'dave@other-grp.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select public.create_workspace('Groups') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'grp.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Campaigns') ->> 'id' as page \gset
select public.create_page(:'ws', :'page', 'Spring campaign') ->> 'id' as child \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016d1';
select public.create_workspace('Other groups') ->> 'id' as other \gset
select public.create_workspace_group(:'other', 'Elsewhere') ->> 'id' as othergroup \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
-- Bob is a member, not an admin.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016b1';
select 'bob creates a group: ' || public.create_workspace_group(:'ws', 'Mine')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select public.create_workspace_group(:'ws', 'Marketing') ->> 'id' as grp \gset
select 'same name again: ' || public.create_workspace_group(:'ws', ' marketing ')::text;
select 'empty name: ' || public.create_workspace_group(:'ws', '  ')::text;
select 'add bob: ' || public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000016b1', true)::text;
select 'add dave (not a member): ' || public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000016d1', true)::text;
select 'another workspace''s group here: ' || public.set_workspace_group_member(:'ws', :'othergroup', '00000000-0000-0000-0000-0000000016b1', true)::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016b1';
select 'bob before: ' || coalesce(public.effective_role(:'page'), 'none');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select 'give the group editor: ' || public.set_page_group_role(:'page', :'grp', 'editor')::text;
select 'a group of another workspace: ' || public.set_page_group_role(:'page', :'othergroup', 'viewer')::text;
select 'bad role: ' || public.set_page_group_role(:'page', :'grp', 'owner')::text;
select 'owner sees: ' || (select string_agg((g ->> 'name') || '=' || (g ->> 'role') || ' own:' || (g ->> 'own'), ', ') from jsonb_array_elements(public.page_sharing(:'page') -> 'groups') g)
  || ', choices: ' || (select string_agg((g ->> 'name') || ' (' || (g ->> 'members') || ')', ', ') from jsonb_array_elements(public.page_sharing(:'page') -> 'all_groups') g);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016b1';
select 'bob on the page: ' || coalesce(public.effective_role(:'page'), 'none') || ', on the subpage: ' || coalesce(public.effective_role(:'child'), 'none');
select 'bob sees pages: ' || count(*) from public.pages where workspace_id = :'ws';
select 'bob gives roles himself: ' || public.set_page_group_role(:'page', :'grp', 'viewer')::text;
select 'bob sees no choice of groups: ' || jsonb_array_length(public.page_sharing(:'page') -> 'all_groups');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016c1';
select 'carol (not in the group): ' || coalesce(public.effective_role(:'page'), 'none');
select 'carol reads the group list: ' || count(*) from public.workspace_groups where workspace_id = :'ws';
select 'carol reads grants of a page she can''t see: ' || count(*) from public.page_group_access where page_id = :'page';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016d1';
select 'dave reads the groups: ' || count(*) from public.workspace_groups where workspace_id = :'ws';
select 'dave reads who is in them: ' || count(*) from public.workspace_group_members where workspace_id = :'ws';

-- The subpage stops inheriting: what the group had from above stays on it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select 'break inheritance: ' || public.set_page_inherit(:'child', false)::text;
select 'group grant copied: ' || (select role from public.page_group_access where page_id = :'child' and group_id = :'grp');
-- Out of the group: the access goes at once, on both pages.
select 'remove bob from the group: ' || public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000016b1', false)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016b1';
select 'bob after: ' || coalesce(public.effective_role(:'page'), 'none') || ', ' || coalesce(public.effective_role(:'child'), 'none');
-- Out of the workspace: out of its groups too.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000016c1', true) ->> 'ok' as ignored \gset
select 'remove carol from the workspace: ' || (public.remove_member(:'ws', '00000000-0000-0000-0000-0000000016c1') ->> 'ok');
reset role;
select 'carol''s group places left: ' || count(*) from public.workspace_group_members where user_id = '00000000-0000-0000-0000-0000000016c1';

-- The copy for a team's own database carries the groups.
select public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000016b1', true) ->> 'ok' as ignored \gset
select 'payload: ' || jsonb_array_length(public.team_sync_payload(:'ws') -> 'groups') || ' group, '
  || jsonb_array_length(public.team_sync_payload(:'ws') -> 'group_members') || ' member';

-- Renaming and deleting; deleting takes its page grants with it.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
select 'rename: ' || public.rename_workspace_group(:'ws', :'grp', 'Growth')::text;
select 'rename someone else''s: ' || public.rename_workspace_group(:'ws', :'othergroup', 'Mine')::text;
select 'delete: ' || public.delete_workspace_group(:'ws', :'grp')::text;
reset role;
select 'grants left: ' || count(*) from public.page_group_access where group_id = :'grp';
select 'logged: ' || string_agg(action, ', ' order by id) from public.audit_log where workspace_id = :'ws' and action like 'group_%';

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000016a1';
insert into public.workspace_groups (workspace_id, name) values (:'ws', 'Direct');
insert into public.page_group_access (workspace_id, page_id, group_id, role) values (:'ws', :'page', :'othergroup', 'editor');
set role anon;
select public.create_workspace_group(:'ws', 'Anon');
reset role;
insert into public.page_group_access (workspace_id, page_id, group_id, role) values (:'ws', :'page', :'othergroup', 'editor');
\set ON_ERROR_STOP 1

delete from public.pages where workspace_id = :'ws';

reset role;
alter table public.pages alter column published_at drop default;
