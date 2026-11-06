-- Analytics: a member sees only their own numbers; the owner sees everyone's and the
-- team's; nobody outside sees anything; a period is required.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000040a1', 'alice@analytix.test', now()),
 ('00000000-0000-0000-0000-0000000040b1', 'bob@analytix.test', now()),
 ('00000000-0000-0000-0000-0000000040e1', 'eve@other-analytix.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a1';
select public.create_workspace('Stats') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'analytix.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Stats', 'STS', null, null) ->> 'id' as project \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040e1';
select public.create_workspace('Other stats') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
select id as done from public.task_statuses where project_id = :'project' and category = 'done' \gset

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a1';
select public.create_task(:'project', jsonb_build_object('title', 'One', 'assignee_id', '00000000-0000-0000-0000-0000000040b1')) ->> 'id' as t1 \gset
select public.create_task(:'project', '{"title": "Two"}') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040b1';
select 'bob comments: ' || (public.add_task_comment(:'t1', 'Done soon', '{}') ->> 'ok');
select 'bob finishes: ' || (public.update_task(:'t1', jsonb_build_object('status_id', :'done')) ->> 'ok');
select 'bob sees only himself: ' || (select string_agg(p ->> 'name' || ' created ' || (p ->> 'created') || ' completed ' || (p ->> 'completed') || ' passed ' || (p ->> 'passed') || ' comments ' || (p ->> 'comments') || ' chars ' || (p ->> 'comment_chars'), '; ')
  from jsonb_array_elements(public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day') -> 'people') p)
  || ', team: ' || coalesce(public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day') ->> 'team', 'none');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a1';
select 'alice sees everyone: ' || (select string_agg(p ->> 'name' || ' ' || (p ->> 'created') || '/' || (p ->> 'completed'), ', ' order by p ->> 'name')
  from jsonb_array_elements(public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day') -> 'people') p);
select 'alice sees the team: created ' || (t ->> 'created') || ', completed ' || (t ->> 'completed') || ', open ' || (t ->> 'open_now') || ', active ' || (t ->> 'active_people') || ', weeks ' || jsonb_array_length(t -> 'weeks')
  from (select public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day') -> 'team' t) s;
select 'no period: ' || public.workspace_analytics(:'ws', null, null)::text;
select 'a period too long: ' || public.workspace_analytics(:'ws', now() - interval '3 years', now())::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040e1';
select 'eve, outside: ' || public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day')::text;
set role anon;
select 'anon: ' || public.workspace_analytics(:'ws', now() - interval '1 day', now() + interval '1 day')::text;
reset role;

delete from public.workspaces where name in ('Stats', 'Other stats');
delete from auth.users where email like '%analytix.test';
