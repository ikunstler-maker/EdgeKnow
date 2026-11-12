-- Rukh 4-2: a project takes larger attachments once a workspace admin raises its limit,
-- and takes the usual ones again when the limit is set back.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000070a1', 'alice@bigfiles.test', now()),
 ('00000000-0000-0000-0000-0000000070b1', 'bob@bigfiles.test', now()),
 ('00000000-0000-0000-0000-0000000070e1', 'eve@other-bigfiles.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
select public.create_workspace('Big files') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'bigfiles.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070e1';
select public.create_workspace('Other big files') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
select public.create_task_project(:'ws', 'Heavy', 'HVY', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000070b1', 'owner') ->> 'ok' as ignored \gset
select public.create_task(:'project', '{"title": "With a film"}') ->> 'id' as task \gset
select 'at the usual limit, 50 MB: ' || (public.begin_large_task_file(:'task', 'film.mov', 'video/quicktime', 52428800) ->> 'error');
-- Only a workspace admin changes the limit (a project's owner who is not one does not).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070b1';
select 'a project owner raises the limit: ' || (public.set_project_file_limits(:'project', 100, 100) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
select 'a workspace admin raises it: ' || (public.set_project_file_limits(:'project', 100, 2048) ->> 'ok')
  || ', beyond the ceiling: ' || (public.set_project_file_limits(:'project', 300, 2048) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070b1';
select public.begin_large_task_file(:'task', 'film.mov', 'video/quicktime', 52428800) ->> 'id' as film \gset
select 'bob starts 50 MB: ' || (:'film' is not null)::text
  || ', 150 MB: ' || (public.begin_large_task_file(:'task', 'long.mov', 'video/quicktime', 157286400) ->> 'error')
  || ', a 1 GB archive: ' || ((public.begin_large_task_file(:'task', 'all.zip', 'application/zip', 1073741824) ->> 'id') is not null)::text
  || ', a 3 GB archive: ' || (public.begin_large_task_file(:'task', 'more.zip', 'application/zip', 3221225472) ->> 'error')
  || ', nothing: ' || (public.begin_large_task_file(:'task', 'empty.bin', 'x/y', 0) ->> 'error');
select 'waiting: ' || string_agg(name || ' ' || mime_type || ' ' || storage_backend || ' large=' || large, '; ' order by name) from public.task_files where task_id = :'task';
select 'bob reads where uploads stand: ' || count(*) from (select 1 from public.task_uploads) q;
-- The usual files keep their limit and kinds.
insert into public.task_files (workspace_id, task_id, name, mime_type, bytes, storage_path) values (:'ws', :'task', 'sneak.mov', 'video/quicktime', 10, 'sneak');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070e1';
select 'a stranger starts a file: ' || (public.begin_large_task_file(:'task', 'x.bin', 'x/y', 10) ->> 'error') || ', sets limits: ' || (public.set_project_file_limits(:'project', 50, 50) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
select 'set back: ' || (public.set_project_file_limits(:'project', 4, 4) ->> 'ok') || ', then 50 MB: ' || (public.begin_large_task_file(:'task', 'again.mov', 'video/quicktime', 52428800) ->> 'error')
  || ', files already there: ' || (select count(*) from public.task_files where task_id = :'task');
reset role;
-- A large file is only ever on the Drive.
update public.task_files set storage_backend = 'supabase' where id = :'film';
