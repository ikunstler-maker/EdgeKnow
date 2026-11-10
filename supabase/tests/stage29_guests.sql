-- Guests (step Г1): invited by the owner or an admin, optionally until a date;
-- they see only what was shared with them (never "the whole workspace" or a
-- group), at most as editors; they create nothing new, see no groups and only
-- the people on what they share; once their date passes they see nothing.
\pset format unaligned
\pset tuples_only on

-- Pages in this file are published when created; drafts have their own test (page drafts).
alter table public.pages alter column published_at set default now();
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000029a1', 'alice@guests.test', now()),
 ('00000000-0000-0000-0000-0000000029b1', 'bob@guests.test', now()),
 ('00000000-0000-0000-0000-0000000029d1', 'dave@guests.test', now()),
 ('00000000-0000-0000-0000-0000000029e1', 'gwen@client.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select public.create_workspace('Guests') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'guests.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

-- Inviting
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select 'a member invites a guest: ' || public.invite_member(:'ws', 'gwen@client.test', 'guest', null)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'a date in the past: ' || public.invite_member(:'ws', 'gwen@client.test', 'guest', now() - interval '1 day')::text;
select 'the owner invites a guest until a date: ' || (public.invite_member(:'ws', 'gwen@client.test', 'guest', now() + interval '30 days') ->> 'ok');
select 'a member invitation has no date: ' || (public.invite_member(:'ws', 'x@client.test', 'member', now() + interval '30 days') ->> 'ok');
reset role;
select 'stored: ' || string_agg(role || ' ' || (access_until is not null), ', ' order by email) from public.invitations where workspace_id = :'ws' and revoked_at is null;
select 'an outside email may sign up with the invitation: ' || (public.hook_before_user_created('{"user":{"email":"gwen@client.test"}}') = '{}'::jsonb);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen joins: ' || (public.join_workspaces() ->> 'ok');
reset role;
select 'gwen is a guest until a date: ' || role || ' ' || (access_until > now()) from public.workspace_members where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-0000000029e1';
set role authenticated;
select 'gwen is in the workspace: ' || public.is_workspace_member(:'ws') || ', has access to the platform: ' || public.has_platform_access();

-- Pages
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select public.create_page(:'ws', null, 'For everyone') ->> 'id' as everyone \gset
select public.set_page_workspace_role(:'everyone', 'editor') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'For the client') ->> 'id' as shared \gset
select public.set_page_workspace_role(:'shared', 'viewer') ->> 'ok' as ignored \gset
select public.create_page(:'ws', :'shared', 'Details') ->> 'id' as details \gset
select 'bob shares with gwen as editor: ' || (public.set_page_member_role(:'shared', '00000000-0000-0000-0000-0000000029e1', 'editor') ->> 'ok');
select 'never as owner: ' || public.transfer_page_ownership(:'shared', '00000000-0000-0000-0000-0000000029e1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees: ' || string_agg(title, ', ' order by title) from public.pages;
select 'gwen''s role on the shared page and below: ' || public.effective_role(:'shared') || ' ' || public.effective_role(:'details');
select 'gwen edits: ' || (public.save_page_content(:'shared', '[]'::jsonb, 1, false) ->> 'ok');
select public.create_page(:'ws', null, 'Gwen top') ->> 'id' as gwen_top \gset
select public.create_page(:'ws', :'shared', 'Gwen below') ->> 'id' as gwen_below \gset
select 'gwen makes pages, she edits them: ' || public.effective_role(:'gwen_top') || ' ' || public.effective_role(:'gwen_below');
select 'gwen can''t share her page: ' || (public.set_page_workspace_role(:'gwen_top', 'viewer') ->> 'error');
reset role;
select 'the workspace owner owns them: ' || string_agg(p.title || ' ' || pr.email, ', ' order by p.title) from public.pages p join public.profiles pr on pr.id = p.owner_id where p.title like 'Gwen %';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'search finds only the shared pages: ' || coalesce((select string_agg(r.title, ', ' order by r.title) from public.search_pages(:'ws', 'for', null, null) r), '-');

-- Tasks
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select public.create_task_project(:'ws', 'Site', 'SITE', null, null) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Draft", "assignee_id": "00000000-0000-0000-0000-0000000029a1"}') ->> 'id' as task \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees a project open to the workspace: ' || count(*) from public.task_projects;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'never owner of a project: ' || public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000029e1', 'owner')::text;
select 'gwen gets edit: ' || (public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000029e1', 'editor') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees it: ' || public.task_project_role(:'project') || ', tasks: ' || (select count(*) from public.tasks);
select 'gwen adds a task: ' || (public.create_task(:'project', '{"title": "From the client"}') ->> 'ok');
select 'gwen makes a project: ' || public.create_task_project(:'ws', 'Mine', 'MINE', null, null)::text;

-- Maps
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Plan', '{}') ->> 'id' as map \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees a map open to the workspace: ' || count(*) from public.service_objects;
select public.create_service_object(:'ws', 'nodes', 'mindmap', 'Gwen map', '{}') ->> 'id' as gwen_map \gset
select 'gwen makes a map, she edits it: ' || public.service_object_role(:'gwen_map');
select 'but doesn''t throw it away: ' || (public.trash_service_object(:'gwen_map', false) ->> 'error');
reset role;
select 'the workspace owner owns it: ' || pr.email from public.service_objects o join public.profiles pr on pr.id = o.owner_id where o.id = :'gwen_map';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select 'never owner of a map: ' || public.set_service_object_member_role(:'map', '00000000-0000-0000-0000-0000000029e1', 'owner')::text;
select 'gwen gets view: ' || (public.set_service_object_member_role(:'map', '00000000-0000-0000-0000-0000000029e1', 'viewer') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees it: ' || public.service_object_role(:'map');

-- Groups give a guest nothing
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select public.create_workspace_group(:'ws', 'Everyone') ->> 'id' as grp \gset
select 'a guest in a group: ' || public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000029e1', true)::text;
reset role;
insert into public.workspace_group_members (group_id, workspace_id, user_id) values (:'grp', :'ws', '00000000-0000-0000-0000-0000000029e1');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select public.set_page_group_role(:'everyone', :'grp', 'editor') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'even if put there, the group opens nothing: ' || coalesce(public.effective_role(:'everyone'), 'none');
select 'gwen sees groups: ' || (select count(*) from public.workspace_groups) || ', group members: ' || (select count(*) from public.workspace_group_members);
reset role;
delete from public.workspace_group_members where user_id = '00000000-0000-0000-0000-0000000029e1';
set role authenticated;

-- People
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees these members: ' || string_agg(p.email, ', ' order by p.email) from public.workspace_members m join public.profiles p on p.id = m.user_id where m.workspace_id = :'ws';
select 'gwen reads these profiles: ' || string_agg(email, ', ' order by email) from public.profiles;
select 'people to mention on the shared page: ' || coalesce((select string_agg(x ->> 'email', ', ' order by x ->> 'email') from jsonb_array_elements(public.mention_candidates(:'shared') -> 'people') x), '-');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select 'bob sees gwen among the members: ' || count(*) from public.workspace_members where workspace_id = :'ws' and role = 'guest';
select 'bob can mention: ' || coalesce((select string_agg(x ->> 'email', ', ' order by x ->> 'email') from jsonb_array_elements(public.mention_candidates(:'shared') -> 'people') x), '-');

-- The workspace itself
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'never owner of the workspace: ' || public.transfer_workspace_ownership(:'ws', '00000000-0000-0000-0000-0000000029e1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen invites: ' || public.invite_member(:'ws', 'y@client.test', 'guest', null)::text;
select 'gwen reads the log: ' || count(*) from public.audit_log;

-- The date
reset role;
update public.workspace_members set access_until = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-0000000029e1';
set role authenticated;
select 'after the date gwen is in: ' || public.is_workspace_member(:'ws') || ', platform: ' || public.has_platform_access() || ', pages: ' || (select count(*) from public.pages) || ', projects: ' || (select count(*) from public.task_projects) || ', maps: ' || (select count(*) from public.service_objects);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029b1';
select 'nobody shares with a guest past the date: ' || public.set_page_member_role(:'everyone', '00000000-0000-0000-0000-0000000029e1', 'viewer')::text;
select 'bob sets the date: ' || public.set_guest_access_until(:'ws', '00000000-0000-0000-0000-0000000029e1', now() + interval '1 day')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'a date in the past: ' || public.set_guest_access_until(:'ws', '00000000-0000-0000-0000-0000000029e1', now() - interval '1 day')::text;
select 'only for guests: ' || public.set_guest_access_until(:'ws', '00000000-0000-0000-0000-0000000029b1', null)::text;
select 'alice gives a new date: ' || (public.set_guest_access_until(:'ws', '00000000-0000-0000-0000-0000000029e1', now() + interval '7 days') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'everything is back: ' || (select count(*) from public.pages) || ' pages, role ' || public.effective_role(:'shared');
reset role;
select 'the team database gets the date: ' || (select (m ->> 'access_until') is not null from jsonb_array_elements(public.team_sync_payload(:'ws') -> 'members') m where m ->> 'role' = 'guest');

-- Becoming a member and back
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'gwen becomes a member: ' || (public.set_member_role(:'ws', '00000000-0000-0000-0000-0000000029e1', 'member') ->> 'ok');
reset role;
select 'no date for a member: ' || coalesce(access_until::text, 'none') from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000029e1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'as a member gwen sees: ' || string_agg(title, ', ' order by title) from public.pages;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000029e1', 'owner') ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'grp', '00000000-0000-0000-0000-0000000029e1', true) ->> 'ok' as ignored \gset
select 'and a guest again: ' || (public.set_member_role(:'ws', '00000000-0000-0000-0000-0000000029e1', 'guest') ->> 'ok');
reset role;
select 'left the groups: ' || count(*) from public.workspace_group_members where user_id = '00000000-0000-0000-0000-0000000029e1';
select 'owner of the project became editor: ' || role from public.task_project_access where user_id = '00000000-0000-0000-0000-0000000029e1';

-- A member who becomes a guest hands what they own to the workspace owner
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029d1';
select public.create_page(:'ws', null, 'Dave''s notes') ->> 'id' as dave_page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'dave becomes a guest: ' || (public.set_member_role(:'ws', '00000000-0000-0000-0000-0000000029d1', 'guest') ->> 'ok');
reset role;
select 'his page now belongs to: ' || pr.email || ', he edits it: ' || (select a.role from public.page_access a where a.page_id = :'dave_page' and a.user_id = '00000000-0000-0000-0000-0000000029d1') from public.pages p join public.profiles pr on pr.id = p.owner_id where p.id = :'dave_page';
set role authenticated;

-- Removing
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029a1';
select 'alice removes gwen: ' || (public.remove_member(:'ws', '00000000-0000-0000-0000-0000000029e1') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000029e1';
select 'gwen sees: ' || count(*) from public.pages;
reset role;
select 'removed: ' || status || ' ' || role || ' ' || coalesce(access_until::text, 'no date') from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000029e1';
select 'gwen''s grants gone: ' || (select count(*) from public.page_access where user_id = '00000000-0000-0000-0000-0000000029e1') || ' ' || (select count(*) from public.task_project_access where user_id = '00000000-0000-0000-0000-0000000029e1') || ' ' || (select count(*) from public.service_object_access where user_id = '00000000-0000-0000-0000-0000000029e1');
delete from public.workspaces where name = 'Guests';
delete from auth.users where email in ('alice@guests.test', 'bob@guests.test', 'dave@guests.test', 'gwen@client.test');

reset role;
alter table public.pages alter column published_at drop default;
