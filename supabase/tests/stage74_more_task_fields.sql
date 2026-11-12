-- Rukh: more kinds of own fields — a duration, a heading, a divider, languages, geos and
-- currencies; a field's width; a copy of a field; one's own value in a list.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000074a1', 'alice@fieldkinds.test', now()),
 ('00000000-0000-0000-0000-0000000074b1', 'bob@fieldkinds.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000074a1';
select public.create_workspace('Kinds') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'fieldkinds.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000074b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000074a1';
select public.create_task_project(:'ws', 'Kinds', 'KND', null, array['To do', 'Doing', 'Done']) ->> 'id' as project \gset
select public.save_task_field(:'project', null, '{"name": "Timing", "kind": "duration", "width": "half"}') ->> 'id' as duration \gset
select public.save_task_field(:'project', null, '{"name": "Where", "kind": "heading"}') ->> 'id' as heading \gset
select public.save_task_field(:'project', null, '{"name": "—", "kind": "divider"}') ->> 'id' as divider \gset
select public.save_task_field(:'project', null, '{"name": "Languages", "kind": "language", "width": "half"}') ->> 'id' as languages \gset
select public.save_task_field(:'project', null, '{"name": "Geo", "kind": "geo"}') ->> 'id' as geo \gset
select public.save_task_field(:'project', null, '{"name": "Currency", "kind": "currency"}') ->> 'id' as currency \gset
select public.save_task_field(:'project', null, '{"name": "Format", "kind": "multiselect", "options": [{"id": "v", "label": "Video"}, {"id": "b", "label": "Banner"}]}') ->> 'id' as format \gset
select public.save_task_field(:'project', null, '{"name": "Stage", "kind": "select", "options": [{"id": "d", "label": "Draft"}]}') ->> 'id' as stage \gset
select 'fields: ' || string_agg(name || ':' || kind || ':' || width, ', ' order by position) from public.task_fields where project_id = :'project';
select 'an unknown width: ' || (public.save_task_field(:'project', null, '{"name": "X", "kind": "text", "width": "third"}') ->> 'error')
  || ', an unknown kind: ' || (public.save_task_field(:'project', null, '{"name": "X", "kind": "country"}') ->> 'error')
  || ', made narrow later: ' || (public.save_task_field(:'project', :'geo', '{"name": "Geo", "options": [], "width": "half"}') ->> 'ok');
select public.create_task(:'project', '{"title": "Kinds of values"}') ->> 'id' as task \gset
select 'values taken: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(
    :'duration', 5400, :'languages', jsonb_build_array('en', 'uk', 'other:Klingon'), :'geo', jsonb_build_array('UA', 'PL'),
    :'currency', jsonb_build_array('UAH', 'EUR'), :'format', jsonb_build_array('v', 'other:Poster'), :'stage', 'other:Somewhere else'))) ->> 'ok');
select 'a duration as text: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'duration', '1h'))) ->> 'error')
  || ', a negative one: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'duration', -5))) ->> 'error')
  || ', a value in a heading: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'heading', 'x'))) ->> 'error')
  || ', a value in a divider: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'divider', true))) ->> 'error')
  || ', a geo that is no code: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'geo', jsonb_build_array('Ukraine!')))) ->> 'error')
  || ', one language, not a list: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'languages', 'en'))) ->> 'error')
  || ', an option that is not there: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'format', jsonb_build_array('zzz')))) ->> 'error')
  || ', an empty own value: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'stage', 'other:'))) ->> 'error');
-- A copy stands right after its field, with the same kind, options and width.
select public.copy_task_field(:'format', 'Format (copy)') ->> 'id' as copied \gset
select 'copied: ' || string_agg(name, ' → ' order by position) || ', the copy: ' || (select kind || ' ' || jsonb_array_length(options) || ' options, ' || width from public.task_fields where id = :'copied')
  from public.task_fields where project_id = :'project' and name like 'Format%';
select 'a copy with no name: ' || (public.copy_task_field(:'format', ' ') ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000074b1';
select 'bob (an editor) copies a field: ' || (public.copy_task_field(:'format', 'Mine') ->> 'error')
  || ', fills a duration: ' || (public.update_task(:'task', jsonb_build_object('custom', jsonb_build_object(:'duration', 60))) ->> 'ok');
reset role;
