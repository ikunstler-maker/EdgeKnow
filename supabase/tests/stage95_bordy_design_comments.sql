-- BORDY-1: comments pinned on a "Design" canvas. Who sees the file reads them; commenters and up
-- write; the author or the file's editors resolve and delete; strangers see nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000095a1', 'alice@bdc.test', now()),
 ('00000000-0000-0000-0000-0000000095b1', 'bob@bdc.test', now()),
 ('00000000-0000-0000-0000-0000000095c1', 'carol@bdc.test', now()),
 ('00000000-0000-0000-0000-0000000095e1', 'eve@other-bdc.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095a1';
select public.create_workspace('Design notes') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'bdc.test') ->> 'ok' as ignored \gset
select public.create_service_object(:'ws', 'boards', 'design', 'Screens', '{"version": 1, "kind": "design", "pages": []}') ->> 'id' as file \gset
select public.create_service_object(:'ws', 'boards', 'board', 'Ideas', '{}') ->> 'id' as board \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095e1';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095a1';
-- The file is closed to the workspace: Bob edits it, Carol only views it.
select public.set_service_object_workspace_role(:'file', null) ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'file', '00000000-0000-0000-0000-0000000095b1', 'editor') ->> 'ok' as ignored \gset
select public.set_service_object_member_role(:'file', '00000000-0000-0000-0000-0000000095c1', 'viewer') ->> 'ok' as ignored \gset
select public.add_design_comment(:'file', 'p1', 10, 20, 'n1', 'Bigger button?') ->> 'id' as thread \gset
select 'alice pins a comment: ' || (:'thread' is not null);
select 'not on an idea board: ' || (public.add_design_comment(:'board', 'p1', 0, 0, null, 'x') ->> 'error');
select 'empty: ' || (public.add_design_comment(:'file', 'p1', 0, 0, null, '   ') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095b1';
select 'bob (editor) replies: ' || (public.add_design_comment(:'file', null, 0, 0, null, 'Agreed', :'thread') ->> 'ok');
select 'bob reads: ' || count(*) from public.design_comments where object_id = :'file';
select 'a reply stays at the pin: ' || (x = 10 and y = 20 and page_id = 'p1') from public.design_comments where parent_id = :'thread';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095c1';
select 'carol (viewer) reads: ' || count(*) || ', writes: ' || (public.add_design_comment(:'file', 'p1', 0, 0, null, 'Me too') ->> 'error') from public.design_comments where object_id = :'file';
select 'carol resolves: ' || (public.resolve_design_comment(:'thread', true) ->> 'error') || ', deletes: ' || (public.delete_design_comment(:'thread') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095e1';
select 'eve (stranger) reads: ' || count(*) || ', writes: ' || (public.add_design_comment(:'file', 'p1', 0, 0, null, 'Hi') ->> 'error') from public.design_comments;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095b1';
select 'bob resolves: ' || (public.resolve_design_comment(:'thread', true) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000095a1';
select 'resolved: ' || (resolved_at is not null) from public.design_comments where id = :'thread';
select 'alice deletes her thread: ' || (public.delete_design_comment(:'thread') ->> 'ok');
select 'replies go with it: ' || count(*) from public.design_comments where object_id = :'file';
reset role;
select 'anon may add: ' || has_function_privilege('anon', 'public.add_design_comment(uuid, text, double precision, double precision, text, text, uuid)', 'execute');
