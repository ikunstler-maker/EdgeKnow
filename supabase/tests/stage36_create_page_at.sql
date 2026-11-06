-- A page made in the browser at once: the database takes the browser's id,
-- answers a retry with the same id, and keeps every check of create_page.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000036a1', 'alice@pageat.test', now()),
 ('00000000-0000-0000-0000-0000000036b1', 'bob@pageat.test', now()),
 ('00000000-0000-0000-0000-0000000036e1', 'eve@other-pageat.test', now());

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036a1';
select public.create_workspace('Page at') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'pageat.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036e1';
select public.create_workspace('Other page at') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036a1';
select 'alice makes a page with her id: ' || public.create_page_at(:'ws', null, '', '00000000-0000-0000-0000-0000000036f1')::text;
select 'the same request again: ' || public.create_page_at(:'ws', null, '', '00000000-0000-0000-0000-0000000036f1')::text;
select 'a child page: ' || (public.create_page_at(:'ws', '00000000-0000-0000-0000-0000000036f1', 'Child', '00000000-0000-0000-0000-0000000036f2') ->> 'ok');
select 'no id: ' || public.create_page_at(:'ws', null, '', null)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036b1';
select 'bob reuses alice''s id: ' || public.create_page_at(:'ws', null, '', '00000000-0000-0000-0000-0000000036f1')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000036e1';
select 'eve, not a member: ' || public.create_page_at(:'ws', null, '', '00000000-0000-0000-0000-0000000036f3')::text;
select 'eve under alice''s page: ' || public.create_page_at(:'ws', '00000000-0000-0000-0000-0000000036f1', '', '00000000-0000-0000-0000-0000000036f4')::text;
set role anon;
select 'anon: ' || public.create_page_at(:'ws', null, '', '00000000-0000-0000-0000-0000000036f5')::text;
reset role;
select 'pages: ' || string_agg(coalesce(nullif(title, ''), '(untitled)') || ' by ' || split_part(p.email, '@', 1), ', ' order by title)
from public.pages g join public.profiles p on p.id = g.created_by where g.workspace_id = :'ws';

delete from public.workspaces where name in ('Page at', 'Other page at');
delete from auth.users where email like '%pageat.test';
