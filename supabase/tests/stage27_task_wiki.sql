-- Task chips on wiki pages: the task lists the pages that mention it — only
-- pages the reader can open, only to readers of the task, only tasks of the
-- same workspace.
\pset format unaligned
\pset tuples_only on

-- Pages in this file are published when created; drafts have their own test (page drafts).
alter table public.pages alter column published_at set default now();
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000027a1', 'alice@taskwiki.test', now()),
 ('00000000-0000-0000-0000-0000000027b1', 'bob@taskwiki.test', now()),
 ('00000000-0000-0000-0000-0000000027c1', 'carol@other-taskwiki.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027a1';
select public.create_workspace('Task wiki') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'taskwiki.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Wiki tasks', 'WT', null, null) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Mentioned"}') ->> 'id' as task \gset
select public.create_page(:'ws', null, 'Plan') ->> 'id' as page \gset
select public.create_page(:'ws', null, 'Private plan') ->> 'id' as private \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027c1';
select public.create_workspace('Other') ->> 'id' as other \gset
select public.create_task_project(:'other', 'Other', 'OT', null, null) ->> 'id' as other_project \gset
select public.create_task(:'other_project', '{"title": "Foreign"}') ->> 'id' as foreign_task \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

-- The private page: only alice (the workspace sees "Plan").
update public.pages set inherit = false, workspace_role = null where id = :'private';
update public.pages set workspace_role = 'editor' where id = :'page';
update public.pages set content = jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
  jsonb_build_object('type', 'taskChip', 'props', jsonb_build_object('taskId', :'task')),
  jsonb_build_object('type', 'taskChip', 'props', jsonb_build_object('taskId', :'foreign_task'))))) where id in (:'page', :'private');
select 'links: ' || count(*) || ', foreign kept out: ' || (count(*) filter (where task_id = :'foreign_task') = 0) from public.task_page_links;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027a1';
select 'alice sees mentions on: ' || string_agg(p.title, ',' order by p.title) from public.task_page_links l join public.pages p on p.id = l.page_id where l.task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027b1';
select 'bob sees mentions on: ' || coalesce(string_agg(p.title, ',' order by p.title), 'none') from public.task_page_links l join public.pages p on p.id = l.page_id where l.task_id = :'task';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027a1';
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027b1';
select 'bob without the project: ' || count(*) from public.task_page_links;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000027c1';
select 'outsider: ' || count(*) from public.task_page_links;
reset role;
update public.pages set content = '[]' where id = :'page';
select 'chip removed: ' || count(*) from public.task_page_links where page_id = :'page';
select 'direct write refused: ' || has_table_privilege('authenticated', 'public.task_page_links', 'insert');
-- Leave nothing for later tests that list every page.
delete from public.workspaces where id in (:'ws', :'other');

reset role;
alter table public.pages alter column published_at drop default;
