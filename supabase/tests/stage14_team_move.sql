-- Moving a workspace into its team database (path C, step 1.7b): the people its
-- data points to, for the server only, and the new setup steps.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000014a1', 'alice@move.test', now()),
 ('00000000-0000-0000-0000-0000000014b1', 'bob@move.test', now()),
 ('00000000-0000-0000-0000-0000000014c1', 'carol@move.test', now()),
 ('00000000-0000-0000-0000-0000000014e1', 'eve@other-move.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000014a1';
select public.create_workspace('Move') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'move.test') ->> 'ok' as ignored \gset
select public.create_page(:'ws', null, 'Moving') ->> 'id' as page \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000014b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000014e1';
select public.create_workspace('Other move') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

-- Bob gets access; Carol never joined and has nothing here; Eve is elsewhere.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000014a1';
select public.set_page_member_role(:'page', '00000000-0000-0000-0000-0000000014b1', 'editor') ->> 'ok' as ignored \gset
reset role;
select 'people: ' || string_agg(p ->> 'email', ', ' order by p ->> 'email') from jsonb_array_elements(public.team_move_people(:'ws')) p;
select 'fields: ' || string_agg(k, ', ' order by k) from jsonb_object_keys(public.team_move_people(:'ws') -> 0) k;
select 'unknown workspace: ' || public.team_move_people(gen_random_uuid())::text;

insert into public.team_databases (workspace_id, project_ref, setup_step, setup_progress) values (:'ws', 'abcdefghijklmnopqrst', 'copy', '{"stage": 2, "offset": 200}');
update public.team_databases set setup_step = 'verify', move_report = '{"ok": true}', moved_at = now() where workspace_id = :'ws';
select 'step: ' || setup_step || ' ' || (moved_at is not null) from public.team_databases where workspace_id = :'ws';
update public.team_databases set setup_step = 'done', return_step = 'copy', return_progress = '{"stage": 0, "offset": 0}' where workspace_id = :'ws';
select 'return: ' || return_step from public.team_databases where workspace_id = :'ws';

\set ON_ERROR_STOP 0
update public.team_databases set setup_step = 'moving' where workspace_id = :'ws';
update public.team_databases set return_step = 'sideways' where workspace_id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000014a1';
select public.team_move_people(:'ws');
set role anon;
select public.team_move_people(:'ws');
reset role;
\set ON_ERROR_STOP 1
delete from public.team_databases where workspace_id = :'ws';
delete from public.pages where id = :'page';
