-- Rukh, access rights one to one (Д-2): comments, attachments and time by the project's
-- permissions, "one's own" apart from "anyone's". Without rows everything is as before.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000073a1', 'alice@more.test', now()),
 ('00000000-0000-0000-0000-0000000073b1', 'bob@more.test', now()),
 ('00000000-0000-0000-0000-0000000073c1', 'carl@more.test', now()),
 ('00000000-0000-0000-0000-0000000073d1', 'dana@more.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073a1';
select public.create_workspace('More rights') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'more.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- alice owns; bob edits, carl comments, dana views.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073a1';
select public.create_task_project(:'ws', 'Talked', 'TLK', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000073b1', 'editor') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000073c1', 'commenter') ->> 'ok' as ignored \gset
select public.set_task_project_member_role(:'project', '00000000-0000-0000-0000-0000000073d1', 'viewer') ->> 'ok' as ignored \gset
select public.set_project_time_tracking(:'project', true, 'all') ->> 'ok' as ignored \gset
select public.create_task(:'project', '{"title": "Talked about"}') ->> 'id' as task \gset

-- The usual rules.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073c1';
select public.add_task_comment(:'task', 'Carl says', '{}') ->> 'id' as carl_comment \gset
select 'usual — a commenter comments: ' || (:'carl_comment' is not null)::text || ', edits his own: ' || (public.edit_task_comment(:'carl_comment', 'Carl says more', false) ->> 'ok')
  || ', attaches: ' || (public.register_task_file(:'task', 'a.txt', 'text/plain', 10) ->> 'error') || ', logs time: ' || (public.save_task_time(:'task', null, 30, current_date, null) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073d1';
select 'usual — a viewer comments: ' || (public.add_task_comment(:'task', 'Dana says', '{}') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073b1';
select public.register_task_file(:'task', 'b.txt', 'text/plain', 10) ->> 'id' as bob_file \gset
select public.save_task_time(:'task', null, 60, current_date, null) ->> 'id' as bob_time \gset
select 'usual — an editor attaches and logs: ' || (:'bob_file' is not null and :'bob_time' is not null)::text
  || ', edits carl''s comment: ' || (public.edit_task_comment(:'carl_comment', 'x', false) ->> 'error') || ', removes it: ' || (public.edit_task_comment(:'carl_comment', null, true) ->> 'error');

-- The owner's rules: viewers may comment; commenters may attach and log time; editors
-- may edit and remove anyone's comments; nobody but owners removes anyone's files;
-- nobody edits their own time once written.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073a1';
select 'rules: ' || (public.set_task_permission(:'project', 'comment_add', '{"roles": ["editor", "commenter", "viewer"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'file_add', '{"roles": ["editor", "commenter"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'time_log', '{"roles": ["editor", "commenter"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'comment_edit_any', '{"roles": ["editor"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'comment_delete_any', '{"roles": ["editor"]}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'file_delete_any', '{"roles": []}') ->> 'ok')
  || ' ' || (public.set_task_permission(:'project', 'time_edit_own', '{"roles": []}') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073d1';
select 'a viewer comments: ' || ((public.add_task_comment(:'task', 'Dana says', '{}') ->> 'id') is not null)::text || ', attaches: ' || (public.register_task_file(:'task', 'd.txt', 'text/plain', 10) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073c1';
select public.register_task_file(:'task', 'c.txt', 'text/plain', 10) ->> 'id' as carl_file \gset
select public.save_task_time(:'task', null, 15, current_date, null) ->> 'id' as carl_time \gset
select 'a commenter attaches and logs: ' || (:'carl_file' is not null and :'carl_time' is not null)::text
  || ', changes his time: ' || (public.save_task_time(:'task', :'carl_time', 20, current_date, null) ->> 'error') || ', removes it: ' || (public.delete_task_time(:'carl_time') ->> 'error')
  || ', removes bob''s file: ' || (public.delete_task_file(:'bob_file') ->> 'error') || ', a big file: ' || (public.begin_large_task_file(:'task', 'c.bin', 'x/y', 10) ->> 'ok')
  || ', what he may: ' || (select string_agg(key, ',' order by key) from jsonb_each_text(public.my_task_permissions(:'task')) where value = 'true');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073b1';
select 'an editor edits carl''s comment: ' || (public.edit_task_comment(:'carl_comment', 'Edited by bob', false) ->> 'ok') || ', removes carl''s file: ' || (public.delete_task_file(:'carl_file') ->> 'error')
  || ', removes his own file: ' || (public.delete_task_file(:'bob_file') ->> 'ok') || ', removes carl''s comment: ' || (public.edit_task_comment(:'carl_comment', null, true) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073a1';
select 'the owner removes carl''s file and time: ' || (public.delete_task_file(:'carl_file') ->> 'ok') || ' ' || (public.delete_task_time(:'carl_time') ->> 'ok')
  || ', on the board she may: ' || public.my_project_permissions(:'project')::text;
select 'only the assignee moves: ' || (public.set_task_permission(:'project', 'transition', '{"roles": [], "assignee": true}') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000073d1';
select 'a viewer on the board may: ' || public.my_project_permissions(:'project')::text;
reset role;
