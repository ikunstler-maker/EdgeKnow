-- Task templates: project templates only by owners, personal ones seen and changed
-- only by their author, values validated as for a task, one default per side.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000041a1', 'alice@templ.test', now()),
 ('00000000-0000-0000-0000-0000000041b1', 'bob@templ.test', now()),
 ('00000000-0000-0000-0000-0000000041e1', 'eve@other-templ.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041a1';
select public.create_workspace('Templ') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'templ.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Templ', 'TPL', null, null) ->> 'id' as project \gset
select public.save_task_field(:'project', null, '{"name": "Size", "kind": "number"}') ->> 'id' as field \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041e1';
select public.create_workspace('Other templ') ->> 'ok' as ignored \gset

-- Alice (owner) makes a project template and a default.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041a1';
select public.save_task_template(:'project', null, false, 'Bug', jsonb_build_object('title', 'Bug: ', 'type', 'bug', 'priority', 'high', 'custom', jsonb_build_object(:'field', 3)), true) ->> 'id' as bug \gset
select 'project template saved: ' || (:'bug' <> '');
select 'second default replaces the first: ' || (public.save_task_template(:'project', null, false, 'Idea', '{"type": "idea"}', true) ->> 'ok')
  || ', defaults: ' || (select count(*) from public.task_templates where is_default and owner_id is null);
select 'bad values refused: ' || (public.save_task_template(:'project', null, false, 'X', '{"priority": "urgent"}', false) ->> 'error')
  || ', unknown keys: ' || (public.save_task_template(:'project', null, false, 'X', '{"status_id": null}', false) ->> 'error')
  || ', unknown field: ' || (public.save_task_template(:'project', null, false, 'X', '{"custom": {"00000000-0000-0000-0000-000000000000": 1}}', false) ->> 'error');

-- Bob (editor) may not touch project templates but has his own.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041b1';
select 'bob makes a project template: ' || (public.save_task_template(:'project', null, false, 'Mine', '{}', false) ->> 'error')
  || ', changes one: ' || (public.save_task_template(:'project', :'bug', false, 'Hacked', '{}', false) ->> 'error')
  || ', deletes one: ' || (public.delete_task_template(:'bug') ->> 'error');
select public.save_task_template(:'project', null, true, 'My bug', '{"type": "bug", "description": [{"type": "paragraph"}]}', true) ->> 'id' as mine \gset
select 'bob sees: ' || string_agg(name || case when owner_id is null then ' (project)' else ' (mine)' end, ', ' order by name) from public.task_templates;
select 'bob passes off his template as alice''s: ' || (public.save_task_template(:'project', :'mine', false, 'x', '{}', false) ->> 'error');

-- Alice does not see Bob's personal template and cannot change or delete it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041a1';
select 'alice sees: ' || string_agg(name, ', ' order by name) from public.task_templates;
select 'alice changes bob''s: ' || (public.save_task_template(:'project', :'mine', true, 'x', '{}', false) ->> 'error')
  || ', deletes it: ' || (public.delete_task_template(:'mine') ->> 'error');

-- Eve, outside, sees and does nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041e1';
select 'eve sees: ' || count(*) from public.task_templates;
select 'eve saves: ' || (public.save_task_template(:'project', null, true, 'x', '{}', false) ->> 'error')
  || ', deletes: ' || (public.delete_task_template(:'bug') ->> 'error');

-- Owners delete project templates; Bob deletes his own.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041a1';
select 'alice deletes: ' || (public.delete_task_template(:'bug') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000041b1';
select 'bob deletes his: ' || (public.delete_task_template(:'mine') ->> 'ok');
reset role;
