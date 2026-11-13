-- Wishlists in tasks: who may add files to a task links a wishlist they see; the link is
-- seen by those the task is open to; strangers and unknown wishlists are refused.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000086a1', 'alice@twl.test', now()),
 ('00000000-0000-0000-0000-0000000086b1', 'bob@twl.test', now()),
 ('00000000-0000-0000-0000-0000000086c1', 'carol@twl.test', now()),
 ('00000000-0000-0000-0000-0000000086e1', 'eve@other-twl.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086a1';
select public.create_workspace('Task wishes') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'twl.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
select public.set_my_birthday(:'ws', extract(month from d)::int, extract(day from d)::int, null, true) ->> 'ok' as ignored
  from (select (now() at time zone 'UTC')::date + 5 as d) x \gset
select public.create_wishlist(:'ws') ->> 'id' as wl \gset
select public.create_wishlist(:'ws') ->> 'id' as same \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086e1';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086a1';
select public.create_task_project(:'ws', 'Party', 'PTY', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.create_task(:'project', '{"title": "Gift for Bob"}') ->> 'id' as task \gset
select 'a draft alice can''t see: ' || (public.add_task_wishlist_link(:'task', :'wl') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086b1';
select public.set_wishlist_published(:'wl', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086a1';
select 'published: ' || (public.add_task_wishlist_link(:'task', :'wl') ->> 'ok') || ', twice: ' || (public.add_task_wishlist_link(:'task', :'wl') ->> 'ok');
select 'links: ' || count(*) from public.task_wishlist_links where task_id = :'task';
select 'not a wishlist: ' || (public.add_task_wishlist_link(:'task', :'project') ->> 'error');
select id as link from public.task_wishlist_links where task_id = :'task' \gset
reset role;
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086c1';
select 'carol (a viewer of the project) sees links: ' || count(*) from public.task_wishlist_links;
select 'carol links: ' || (public.add_task_wishlist_link(:'task', :'wl') ->> 'error') || ', removes alice''s: ' || (public.delete_task_wishlist_link(:'link') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086e1';
select 'stranger sees links: ' || count(*) from public.task_wishlist_links;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086a1';
select 'alice removes it: ' || (public.delete_task_wishlist_link(:'link') ->> 'ok');
select public.add_task_wishlist_link(:'task', :'wl') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000086b1';
select public.delete_wishlist(:'wl') ->> 'ok' as ignored \gset
reset role;
select 'link goes with the wishlist: ' || count(*) from public.task_wishlist_links where task_id = :'task';
