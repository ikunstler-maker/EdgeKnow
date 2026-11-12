-- Rukh: links kept with a task. Whoever may edit the task adds and removes them; they are
-- seen by those who see the task; only real web addresses are taken.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000068a1', 'alice@weblinks.test', now()),
 ('00000000-0000-0000-0000-0000000068b1', 'bob@weblinks.test', now()),
 ('00000000-0000-0000-0000-0000000068e1', 'eve@other-weblinks.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068a1';
select public.create_workspace('Links') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'weblinks.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068e1';
select public.create_workspace('Other links') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068a1';
select public.create_task_project(:'ws', 'Linked', 'LNK', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
select public.create_task(:'project', '{"title": "With links"}') ->> 'id' as task \gset
select public.add_task_web_link(:'task', 'Design file', 'https://example.com/design?x=1') ->> 'id' as link \gset
select 'added: ' || (:'link' is not null)::text
  || ', no title: ' || (public.add_task_web_link(:'task', '  ', 'http://example.com/a') ->> 'ok')
  || ', a script: ' || (public.add_task_web_link(:'task', 'x', 'javascript:alert(1)') ->> 'error')
  || ', with a space: ' || (public.add_task_web_link(:'task', 'x', 'https://example.com/a b') ->> 'error');
select 'alice sees: ' || string_agg(title || ' → ' || url, '; ' order by created_at, title) from public.task_web_links where task_id = :'task';
-- A viewer sees the links and changes nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068b1';
select 'bob (a viewer) sees: ' || count(*) || ', adds: ' || (public.add_task_web_link(:'task', 'Mine', 'https://example.com/b') ->> 'error')
  || ', removes: ' || (public.delete_task_web_link(:'link') ->> 'error') from public.task_web_links where task_id = :'task';
insert into public.task_web_links (workspace_id, task_id, title, url) values (:'ws', :'task', 'direct', 'https://example.com/c');
-- A stranger sees and does nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068e1';
select 'a stranger sees: ' || count(*) || ', adds: ' || (public.add_task_web_link(:'task', 'x', 'https://example.com') ->> 'error')
  || ', removes: ' || (public.delete_task_web_link(:'link') ->> 'error') from public.task_web_links;
-- A private task's links are for those who see the task.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068a1';
select public.set_task_private(:'task', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068b1';
select 'bob sees a private task''s links: ' || count(*) from public.task_web_links;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000068a1';
select 'alice removes: ' || (public.delete_task_web_link(:'link') ->> 'ok');
select 'left: ' || count(*) from public.task_web_links where task_id = :'task';
reset role;
