-- Task files: editors attach, everyone who sees the task sees them, others see
-- nothing; only those who manage the project choose where files go; the Drive
-- accesses are never readable by people; EdgeKnow's storage keeps its limit.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000026a1', 'alice@taskfiles.test', now()),
 ('00000000-0000-0000-0000-0000000026b1', 'bob@taskfiles.test', now()),
 ('00000000-0000-0000-0000-0000000026c1', 'carol@other-taskfiles.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026a1';
select public.create_workspace('Files') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'taskfiles.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Files', 'FIL', null, null) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "With files"}') ->> 'id' as task \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026c1';
select public.create_workspace('Other') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026b1';
select 'default target: ' || files_target from public.task_projects where id = :'project';
select public.register_task_file(:'task', 'brief.pdf', 'application/pdf', 1000) as reg \gset
select 'bob attaches: ' || (:'reg'::jsonb ->> 'ok') || ' to ' || (:'reg'::jsonb ->> 'target') || ', path ok: ' || ((:'reg'::jsonb ->> 'path') = :'ws' || '/tasks/' || :'task' || '/' || (:'reg'::jsonb ->> 'id'));
select 'a page as a file: ' || public.register_task_file(:'task', 'x.html', 'text/html', 10)::text;
select 'too large: ' || public.register_task_file(:'task', 'big.zip', 'application/zip', 5000000)::text;
select 'no name: ' || public.register_task_file(:'task', '  ', 'text/plain', 5)::text;
select 'bob changes where files go: ' || public.update_task_project(:'project', '{"files_target": "edgeknow"}')::text;
select 'bob sees: ' || count(*) from public.task_files;
select 'bob sees drive accesses: ' || count(*) from public.drive_accounts;
reset role;
select 'direct write refused: ' || has_table_privilege('authenticated', 'public.task_files', 'insert') || ', drive accounts readable: ' || has_table_privilege('authenticated', 'public.drive_accounts', 'select');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026c1';
select 'outsider sees: ' || count(*) from public.task_files;
select 'outsider attaches: ' || public.register_task_file(:'task', 'x.txt', 'text/plain', 5)::text;
select 'outsider removes: ' || public.delete_task_file((:'reg'::jsonb ->> 'id')::uuid)::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026a1';
select 'unknown target: ' || public.update_task_project(:'project', '{"files_target": "dropbox"}')::text;
select 'alice: EdgeKnow storage: ' || (public.update_task_project(:'project', '{"files_target": "edgeknow"}') ->> 'ok');
reset role;
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026a1';
select 'within the limit: ' || (public.register_task_file(:'task', 'a.png', 'image/png', 500000) ->> 'ok');
select 'over the limit: ' || public.register_task_file(:'task', 'b.png', 'image/png', 600000)::text;
-- The limit is EdgeKnow's: with the workspace's Google Drive connected (all files go there), none.
reset role;
insert into public.drive_connections (workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted)
values (:'ws', 'drive@files.test', 'r', 'f', 'b', 'v1.x.y.z');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026a1';
select 'with the Drive connected, no limit: ' || (public.register_task_file(:'task', 'c.png', 'image/png', 600000) ->> 'ok');

-- Viewers neither attach nor remove others' files; the uploader removes their own.
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000026b1';
select 'viewer attaches: ' || public.register_task_file(:'task', 'x.txt', 'text/plain', 5)::text;
select 'viewer removes alice''s file: ' || public.delete_task_file(id)::text from public.task_files where name = 'a.png';
select 'bob removes his own: ' || (public.delete_task_file((:'reg'::jsonb ->> 'id')::uuid) ->> 'ok');
reset role;
select 'left for the daily cleanup: ' || count(*) from public.attachment_tombstones where storage_path = :'reg'::jsonb ->> 'path';
select 'files now: ' || string_agg(name, ',' order by name) from public.task_files where task_id = :'task';
-- Leave nothing for later tests that count the cleanup list.
delete from public.attachment_tombstones where storage_path like :'ws' || '/%';
