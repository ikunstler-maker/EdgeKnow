-- CORE-3 and CORE-5 (runs last, over everyone the other tests created): the read rules in force
-- for tasks, pages, service objects and the records of tasks (comments, history, files, board
-- places, time, links), rewritten to check once per query, let every person read exactly the
-- rows the original per-row rules did (a denied row counts the same whether a rule says false or null).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
create temp table want (kind text, person uuid, item text);
create temp table got (kind text, person uuid, item text);
grant all on pg_temp.want, pg_temp.got to authenticated;
do $$
declare u record; n int := 0;
begin
  for u in select distinct on (user_id) user_id as id, workspace_id as ws from public.workspace_members loop
    n := n + 1;
    perform set_config('request.jwt.claim.sub', u.id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated', 'iss', 'https://wiki.test/oidc', 'ek_workspace', u.ws)::text, true);
    -- What the per-row rules allowed (checked as the database's owner)…
    insert into pg_temp.want select 'tasks', u.id, t.id::text from public.tasks t where coalesce(public.is_workspace_member(t.workspace_id) and public.task_project_role(t.project_id) is not null and public.task_read_until(t.id) = 'infinity', false);
    insert into pg_temp.want select 'pages', u.id, t.id::text from public.pages t where coalesce(public.is_workspace_member(t.workspace_id) and public.effective_role(t.id) is not null, false);
    insert into pg_temp.want select 'objects', u.id, t.id::text from public.service_objects t where coalesce(public.is_workspace_member(t.workspace_id) and public.service_object_role(t.id) is not null, false);
    insert into pg_temp.want select 'comments', u.id, t.id::text from public.task_comments t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id), false);
    insert into pg_temp.want select 'events', u.id, t.id::text from public.task_events t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id), false);
    insert into pg_temp.want select 'files', u.id, t.id::text from public.task_files t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id), false);
    insert into pg_temp.want select 'placements', u.id, t.task_id::text || '/' || t.board_key::text from public.task_placements t where coalesce(public.is_workspace_member(t.workspace_id) and public.board_visible(t.board_id) and public.task_read_until(t.task_id) is not null, false);
    insert into pg_temp.want select 'time', u.id, t.id::text from public.task_time_entries t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id) and (t.user_id = auth.uid() or public.sees_task_time(t.task_id)), false);
    insert into pg_temp.want select 'web_links', u.id, t.id::text from public.task_web_links t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id), false);
    insert into pg_temp.want select 'wishlist_links', u.id, t.id::text from public.task_wishlist_links t where coalesce(public.is_workspace_member(t.workspace_id) and t.created_at <= public.task_read_until(t.task_id), false);
    -- …and what the rules in force let the person read.
    execute 'set local role authenticated';
    insert into pg_temp.got select 'tasks', u.id, t.id::text from public.tasks t;
    insert into pg_temp.got select 'pages', u.id, t.id::text from public.pages t;
    insert into pg_temp.got select 'objects', u.id, t.id::text from public.service_objects t;
    insert into pg_temp.got select 'comments', u.id, t.id::text from public.task_comments t;
    insert into pg_temp.got select 'events', u.id, t.id::text from public.task_events t;
    insert into pg_temp.got select 'files', u.id, t.id::text from public.task_files t;
    insert into pg_temp.got select 'placements', u.id, t.task_id::text || '/' || t.board_key::text from public.task_placements t;
    insert into pg_temp.got select 'time', u.id, t.id::text from public.task_time_entries t;
    insert into pg_temp.got select 'web_links', u.id, t.id::text from public.task_web_links t;
    insert into pg_temp.got select 'wishlist_links', u.id, t.id::text from public.task_wishlist_links t;
    execute 'reset role';
  end loop;
  raise notice 'checked % people', case when n > 5 then 'enough' else 'too few' end;
end $$;
select k.kind || ': ' || coalesce((select count(*) from ((select person, item from pg_temp.want where kind = k.kind) except (select person, item from pg_temp.got where kind = k.kind)) a), 0) || ' hidden that were readable, '
  || coalesce((select count(*) from ((select person, item from pg_temp.got where kind = k.kind) except (select person, item from pg_temp.want where kind = k.kind)) a), 0) || ' readable that were hidden'
from (values ('tasks'), ('pages'), ('objects'), ('comments'), ('events'), ('files'), ('placements'), ('time'), ('web_links'), ('wishlist_links')) k(kind) order by k.kind;
