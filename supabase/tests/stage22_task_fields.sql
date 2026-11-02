-- A project's own fields: only its owners define them, values must fit their
-- kind, list items come from the field, clearing and deleting work.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000022a1', 'alice@fields.test', now()),
 ('00000000-0000-0000-0000-0000000022b1', 'bob@fields.test', now()),
 ('00000000-0000-0000-0000-0000000022d1', 'dave@other-fields.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022a1';
select public.create_workspace('Fields') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'fields.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Design', 'DES', null, null) ->> 'id' as project \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022b1';
select 'bob defines a field: ' || public.save_task_field(:'project', null, '{"name": "Mine", "kind": "text"}')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022a1';
select public.save_task_field(:'project', null, '{"name": "Format", "kind": "select", "options": [{"id": "v", "label": "Відео", "color": "#ff8800"}, {"id": "s", "label": "Статика"}]}') ->> 'id' as fmt \gset
select public.save_task_field(:'project', null, '{"name": "Approved", "kind": "toggle"}') ->> 'id' as ok_field \gset
select public.save_task_field(:'project', null, '{"name": "Brand colour", "kind": "color"}') ->> 'id' as colour \gset
select public.save_task_field(:'project', null, '{"name": "Reference", "kind": "url"}') ->> 'id' as link \gset
select public.save_task_field(:'project', null, '{"name": "Reviewer", "kind": "person"}') ->> 'id' as reviewer \gset
select public.save_task_field(:'project', null, '{"name": "Frames", "kind": "number"}') ->> 'id' as frames \gset
select public.save_task_field(:'project', null, '{"name": "Platforms", "kind": "multiselect", "options": [{"id": "ig", "label": "Instagram"}, {"id": "yt", "label": "YouTube"}]}') ->> 'id' as platforms \gset
select 'bug template field: ' || (public.save_task_field(:'project', null, '{"name": "Steps", "kind": "longtext", "task_types": ["bug"]}') ->> 'ok');
select 'duplicate items: ' || public.save_task_field(:'project', null, '{"name": "Bad", "kind": "select", "options": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]}')::text;
select 'unknown kind: ' || public.save_task_field(:'project', null, '{"name": "Bad", "kind": "spreadsheet"}')::text;
select 'fields: ' || string_agg(name || ':' || kind || coalesce('[' || array_to_string(task_types, ',') || ']', ''), ', ' order by position) from public.task_fields where project_id = :'project';

-- Values must fit.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022b1';
select public.create_task(:'project', jsonb_build_object('title', 'Reel', 'custom', jsonb_build_object(:'fmt', 'v', :'frames', 240, :'platforms', '["ig", "yt"]'::jsonb))) as made \gset
select 'with fields: ' || (:'made'::jsonb ->> 'key');
select (:'made'::jsonb ->> 'id') as task \gset
select 'an item that isn''t there: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'fmt', 'x')))::text;
select 'a number as text: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'frames', '240')))::text;
select 'a field of another project: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(gen_random_uuid()::text, 'x')))::text;
select 'not a colour: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'colour', 'orange')))::text;
select 'not a link: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'link', 'javascript:alert(1)')))::text;
select 'someone from elsewhere: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'reviewer', '00000000-0000-0000-0000-0000000022d1')))::text;
select 'fitting values: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'ok_field', true, :'colour', '#12ab9F', :'link', 'https://example.com/ref', :'reviewer', '00000000-0000-0000-0000-0000000022a1')))::text;
select 'clear the format: ' || public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'fmt', null)))::text;
reset role;
select 'values: ' || (select string_agg(f.name || '=' || (t.custom -> f.id::text)::text, ', ' order by f.position) from public.task_fields f, public.tasks t where t.id = :'task' and t.custom ? f.id::text);
select 'history has it: ' || count(*) from public.task_events where task_id = :'task' and field = 'custom';

-- Renaming keeps the kind; deleting clears the values.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022a1';
select 'rename: ' || (public.save_task_field(:'project', :'frames', '{"name": "Frame count", "kind": "text"}') ->> 'ok');
reset role;
select 'still a number: ' || kind from public.task_fields where id = :'frames';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022b1';
select 'bob deletes a field: ' || public.delete_task_field(:'frames')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022a1';
select 'delete: ' || public.delete_task_field(:'frames')::text;
reset role;
select 'its value is gone: ' || not (custom ? :'frames') from public.tasks where id = :'task';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000022d1';
select 'dave sees fields: ' || count(*) from public.task_fields where workspace_id = :'ws';
\set ON_ERROR_STOP 0
insert into public.task_fields (project_id, workspace_id, name, kind) values (:'project', :'ws', 'direct', 'text');
reset role;
\set ON_ERROR_STOP 1
