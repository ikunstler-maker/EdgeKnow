-- Company structure, stage 1: units form a tree (no cycles, at most 8 levels), only
-- workspace admins change it, deleting a middle unit lifts its sub-units, and access
-- through groups is unchanged.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000045a1', 'alice@tree.test', now()),
 ('00000000-0000-0000-0000-0000000045b1', 'bob@tree.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000045a1';
select public.create_workspace('Tree') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'tree.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000045b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000045a1';
select public.create_workspace_group(:'ws', 'Company') ->> 'id' as company \gset
select public.create_workspace_group(:'ws', 'Marketing', :'company') ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design team', :'marketing') ->> 'id' as design \gset
select 'tree: ' || string_agg(g.name || '<' || coalesce(p.name, '-'), ', ' order by g.name)
from public.workspace_groups g left join public.workspace_groups p on p.id = g.parent_id where g.workspace_id = :'ws';
select 'cycle: ' || public.move_workspace_group(:'ws', :'company', :'design', null)::text;
select 'into itself: ' || public.move_workspace_group(:'ws', :'company', :'company', null)::text;
select 'unknown parent: ' || public.create_workspace_group(:'ws', 'Lost', gen_random_uuid())::text;
-- Eight levels fit, a ninth does not.
select public.create_workspace_group(:'ws', 'L4', :'design') ->> 'id' as l4 \gset
select public.create_workspace_group(:'ws', 'L5', :'l4') ->> 'id' as l5 \gset
select public.create_workspace_group(:'ws', 'L6', :'l5') ->> 'id' as l6 \gset
select public.create_workspace_group(:'ws', 'L7', :'l6') ->> 'id' as l7 \gset
select public.create_workspace_group(:'ws', 'L8', :'l7') ->> 'id' as l8 \gset
select 'ninth level: ' || public.create_workspace_group(:'ws', 'L9', :'l8')::text;
select 'L9 not kept: ' || count(*) from public.workspace_groups where name = 'L9';
select 'deep move: ' || public.move_workspace_group(:'ws', :'l4', :'l8', null)::text;
select 'move to top: ' || (public.move_workspace_group(:'ws', :'l4', null, 3) ->> 'ok');
select 'L4 at top: ' || (parent_id is null) || ' ' || position from public.workspace_groups where id = :'l4';

-- Bob (member) sees the tree but cannot change it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000045b1';
select 'bob sees units: ' || count(*) from public.workspace_groups where workspace_id = :'ws';
select 'bob moves: ' || public.move_workspace_group(:'ws', :'design', null, null)::text;
select 'bob creates: ' || public.create_workspace_group(:'ws', 'Bobs', :'company')::text;
\set ON_ERROR_STOP 0
update public.workspace_groups set parent_id = null where id = :'design';
\set ON_ERROR_STOP 1

-- Deleting the middle unit lifts its sub-units one level up.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000045a1';
select 'delete marketing: ' || (public.delete_workspace_group(:'ws', :'marketing') ->> 'ok');
select 'design now under: ' || coalesce((select p.name from public.workspace_groups g join public.workspace_groups p on p.id = g.parent_id where g.id = :'design'), '-');
reset role;
select 'team copy has parents: ' || count(*) from jsonb_array_elements(public.team_sync_payload(:'ws') -> 'groups') x where x ? 'parent_id';
-- The whole workspace still goes in one step.
delete from public.workspaces where id = :'ws';
select 'units left: ' || count(*) from public.workspace_groups where workspace_id = :'ws';
