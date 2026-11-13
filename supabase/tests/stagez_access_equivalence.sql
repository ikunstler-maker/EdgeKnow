-- CORE-3 (runs last, over everyone the other tests created): the read rules of tasks, pages and
-- service objects, rewritten to check once per query, let every person read exactly the rows
-- the per-row rules did (a denied row counts the same whether the rule says false or null).
\pset format unaligned
\pset tuples_only on
do $$
declare u record; bad_t int := 0; bad_p int := 0; bad_o int := 0; n int := 0; seen int := 0; x int;
begin
  for u in select id from auth.users loop
    perform set_config('request.jwt.claim.sub', u.id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated', 'iss', 'https://wiki.test/oidc')::text, true);
    n := n + 1;
    select count(*) into x from public.tasks t where
      coalesce(public.is_workspace_member(t.workspace_id) and public.task_project_role(t.project_id) is not null and public.task_read_until(t.id) = 'infinity', false)
      is distinct from coalesce
      (t.workspace_id in (select public.my_workspace_ids()) and t.project_id in (select public.my_task_project_ids())
       and public.task_visible_to_me(t.id) and (t.project_id in (select public.my_task_project_ids(true)) or public.task_not_frozen_for_me(t.id)), false);
    bad_t := bad_t + x;
    select count(*) into x from public.pages p where
      coalesce(public.is_workspace_member(p.workspace_id) and public.effective_role(p.id) is not null, false)
      is distinct from coalesce(p.workspace_id in (select public.my_workspace_ids()) and public.my_page_role(p.id) is not null, false);
    bad_p := bad_p + x;
    select count(*) into x from public.service_objects o where
      coalesce(public.is_workspace_member(o.workspace_id) and public.service_object_role(o.id) is not null, false)
      is distinct from coalesce(o.workspace_id in (select public.my_workspace_ids()) and public.my_object_role(o.id) is not null, false);
    bad_o := bad_o + x;
    select count(*) into x from public.tasks t where public.is_workspace_member(t.workspace_id) and public.task_read_until(t.id) = 'infinity';
    seen := seen + x;
  end loop;
  raise notice 'checked % people; mismatches: tasks %, pages %, objects %', case when n > 5 then 'enough' else 'too few' end, bad_t, bad_p, bad_o;
end $$;
