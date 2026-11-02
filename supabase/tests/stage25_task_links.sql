-- Subtasks, links and bulk edit: no parent loops; a link needs an editor on
-- one side who sees the other; a hidden task stays hidden; a bulk change is
-- all or nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000025a1', 'alice@links.test', now()),
 ('00000000-0000-0000-0000-0000000025b1', 'bob@links.test', now()),
 ('00000000-0000-0000-0000-0000000025c1', 'carol@other-links.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025a1';
select public.create_workspace('Links') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'links.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Links', 'LNK', null, null) ->> 'id' as project \gset
select public.create_task_project(:'ws', 'Private', 'PRV', null, null) ->> 'id' as private \gset
select public.update_task_project(:'private', '{"workspace_role": null}') ->> 'ok' as ignored \gset
select public.create_task(:'private', '{"title": "Secret"}') ->> 'id' as secret \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
select public.create_task(:'project', '{"title": "Epic", "type": "epic"}') ->> 'id' as epic \gset
select public.create_task(:'project', '{"title": "A"}') ->> 'id' as a \gset
select public.create_task(:'project', '{"title": "B"}') ->> 'id' as b \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025c1';
select public.create_workspace('Other') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025b1';
select 'subtask under the epic: ' || (public.update_task(:'a', jsonb_build_object('parent_id', :'epic')) ->> 'ok');
select 'b under a: ' || (public.update_task(:'b', jsonb_build_object('parent_id', :'a')) ->> 'ok');
select 'the epic under b (a loop): ' || public.update_task(:'epic', jsonb_build_object('parent_id', :'b'))::text;
select 'a under itself: ' || public.update_task(:'a', jsonb_build_object('parent_id', :'a'))::text;
select 'parent from a hidden project: ' || public.update_task(:'a', jsonb_build_object('parent_id', :'secret'))::text;
select 'a blocks b: ' || (public.add_task_link(:'a', :'b', 'blocks') ->> 'ok');
select 'b blocks a too: ' || public.add_task_link(:'b', :'a', 'blocks')::text;
select 'a relates to b: ' || (public.add_task_link(:'a', :'b', 'relates') ->> 'ok');
select 'to itself: ' || public.add_task_link(:'a', :'a', 'relates')::text;
select 'unknown kind: ' || public.add_task_link(:'a', :'epic', 'causes')::text;
select 'to a hidden task: ' || public.add_task_link(:'a', :'secret', 'blocks')::text;
select 'from a hidden task: ' || public.add_task_link(:'secret', :'a', 'blocks')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025a1';
select 'alice: the secret blocks a: ' || (public.add_task_link(:'secret', :'a', 'blocks') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025b1';
select 'bob sees links: ' || count(*) from public.task_links;
select 'bob sees the secret task: ' || count(*) from public.tasks where id = :'secret';
select 'history of a: ' || string_agg(field || ':' || coalesce(new_value ->> 'kind', ''), ',' order by field, new_value ->> 'kind') from public.task_events where task_id = :'a' and field = 'link';
reset role;
select id as rel from public.task_links where kind = 'relates' \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025c1';
select 'outsider sees links: ' || count(*) from public.task_links;
select 'outsider links: ' || public.add_task_link(:'a', :'b', 'duplicates')::text;
select 'outsider unlinks: ' || public.delete_task_link(:'rel')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025b1';
select 'bob unlinks relates: ' || (public.delete_task_link(:'rel') ->> 'ok');

-- Bulk edit
select 'bulk priority: ' || public.bulk_update_tasks(array[:'a', :'b']::uuid[], '{"priority": "high"}')::text;
select 'bulk with a hidden task: ' || (public.bulk_update_tasks(array[:'a', :'secret']::uuid[], '{"priority": "low"}') ->> 'error');
select 'a is still: ' || priority from public.tasks where id = :'a';
select 'bulk unknown change: ' || public.bulk_update_tasks(array[:'a']::uuid[], '{"title": "x"}')::text;
select 'bulk add label: ' || (public.bulk_update_tasks(array[:'a', :'b']::uuid[], '{"add_label": "ui"}') ->> 'ok');
select 'bulk add it again: ' || (public.bulk_update_tasks(array[:'a']::uuid[], '{"add_label": "ui"}') ->> 'ok');
select 'labels: ' || string_agg(title || '=' || array_to_string(labels, '|'), ',' order by title) from public.tasks where id in (:'a', :'b');
select 'bulk remove label: ' || (public.bulk_update_tasks(array[:'b']::uuid[], '{"remove_label": "ui"}') ->> 'ok');
select 'b labels: ' || coalesce(nullif(array_to_string(labels, '|'), ''), 'none') from public.tasks where id = :'b';
select 'bulk under epic: ' || (public.bulk_update_tasks(array[:'b']::uuid[], jsonb_build_object('parent_id', :'epic')) ->> 'changed');
select 'bulk epic into a loop: ' || (public.bulk_update_tasks(array[:'epic']::uuid[], jsonb_build_object('parent_id', :'a')) ->> 'error');
select 'too many: ' || public.bulk_update_tasks(array[]::uuid[], '{"priority": "low"}')::text;
select 'bulk delete: ' || (public.bulk_update_tasks(array[:'a', :'b']::uuid[], '{"delete": true}') ->> 'changed');
select 'deleted: ' || count(*) from public.tasks where id in (:'a', :'b') and deleted_at is not null;
select 'link to a deleted task: ' || public.add_task_link(:'epic', :'a', 'relates')::text;

-- Viewers can't link
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025a1';
select public.update_task_project(:'project', '{"workspace_role": "viewer"}') ->> 'ok' as ignored \gset
select public.delete_task(:'a', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000025b1';
select 'viewer links: ' || public.add_task_link(:'epic', :'a', 'relates')::text;
select 'viewer unlinks: ' || public.delete_task_link(id)::text from public.task_links where kind = 'blocks' and source_id = :'a';
select 'viewer bulk: ' || (public.bulk_update_tasks(array[:'a']::uuid[], '{"priority": "low"}') ->> 'error');
reset role;
select 'direct write refused: ' || has_table_privilege('authenticated', 'public.task_links', 'insert');
