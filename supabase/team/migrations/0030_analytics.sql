-- Analytics in a team's own database (as supabase/migrations/20261214100000_analytics.sql).
-- Rollback: supabase/team/rollbacks/0030_analytics.down.sql

-- Package 6: analytics for a period. Everyone sees their own numbers; the workspace's
-- owner and admins see everyone's (guests too, and people who left) and the team
-- metrics. Only counts and times leave the database, never contents.
create function public.workspace_analytics(ws uuid, since timestamptz, until timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  admin boolean;
  people jsonb;
  team jsonb;
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if since is null or until is null or until <= since or until - since > interval '400 days' then
    return public.page_error('invalid');
  end if;
  admin := exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = me
                   and m.status = 'active' and m.role in ('owner', 'admin'));

  with who as (
    -- Everyone who did anything in the workspace (also people who left), or only me.
    select distinct x as user_id from (
      select t.reporter_id x from public.tasks t where t.workspace_id = ws
      union select t.assignee_id from public.tasks t where t.workspace_id = ws
      union select c.author_id from public.task_comments c where c.workspace_id = ws
      union select f.uploaded_by from public.task_files f where f.workspace_id = ws
      union select p.user_id from public.page_contributions p where p.workspace_id = ws
      union select m.user_id from public.workspace_members m where m.workspace_id = ws
    ) s
    where x is not null and (admin or x = me)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', w.user_id,
    'name', coalesce(pr.name, pr.email),
    'role', (select m.role from public.workspace_members m where m.workspace_id = ws and m.user_id = w.user_id),
    'active', exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = w.user_id and m.status = 'active'),
    'created', (select count(*) from public.tasks t where t.workspace_id = ws and t.reporter_id = w.user_id and t.created_at >= since and t.created_at < until),
    'completed', (select count(*) from public.tasks t where t.workspace_id = ws and t.assignee_id = w.user_id and t.done_at >= since and t.done_at < until),
    'passed', (select count(distinct id) from (
                 select t.id from public.tasks t where t.workspace_id = ws and t.assignee_id = w.user_id and t.created_at >= since and t.created_at < until
                 union select e.task_id from public.task_events e where e.workspace_id = ws and e.field = 'assignee_id'
                   and e.new_value = to_jsonb(w.user_id::text) and e.created_at >= since and e.created_at < until) s),
    'files', (select count(*) from public.task_files f where f.workspace_id = ws and f.uploaded_by = w.user_id and f.created_at >= since and f.created_at < until),
    'comments', (select count(*) from public.task_comments c where c.workspace_id = ws and c.author_id = w.user_id and c.created_at >= since and c.created_at < until),
    'comment_chars', (select coalesce(sum(char_length(c.body)), 0) from public.task_comments c where c.workspace_id = ws and c.author_id = w.user_id and c.created_at >= since and c.created_at < until),
    'pages_edited', (select count(*) from public.page_contributions p where p.workspace_id = ws and p.user_id = w.user_id and p.last_saved_at >= since and p.last_saved_at < until),
    'open_now', (select count(*) from public.tasks t where t.workspace_id = ws and t.assignee_id = w.user_id and t.done_at is null and t.deleted_at is null),
    'overdue_now', (select count(*) from public.tasks t where t.workspace_id = ws and t.assignee_id = w.user_id and t.done_at is null and t.deleted_at is null and t.due_date < current_date)
  ) order by coalesce(pr.name, pr.email)), '[]'::jsonb)
  into people
  from who w left join public.profiles pr on pr.id = w.user_id;

  if admin then
    team := jsonb_build_object(
      -- Tasks whose people left the platform (their account deleted) count here, without a name.
      'former', jsonb_build_object(
        'created', (select count(*) from public.tasks t where t.workspace_id = ws and t.reporter_id is null and t.created_at >= since and t.created_at < until),
        'completed', (select count(*) from public.tasks t where t.workspace_id = ws and t.assignee_id is null and t.done_at >= since and t.done_at < until)),
      'created', (select count(*) from public.tasks t where t.workspace_id = ws and t.created_at >= since and t.created_at < until),
      'completed', (select count(*) from public.tasks t where t.workspace_id = ws and t.done_at >= since and t.done_at < until),
      'lead_days_median', (select round((percentile_cont(0.5) within group (order by extract(epoch from t.done_at - t.created_at)) / 86400)::numeric, 1)
                           from public.tasks t where t.workspace_id = ws and t.done_at >= since and t.done_at < until),
      'lead_days_avg', (select round((avg(extract(epoch from t.done_at - t.created_at)) / 86400)::numeric, 1)
                        from public.tasks t where t.workspace_id = ws and t.done_at >= since and t.done_at < until),
      'on_time_share', (select round(100.0 * count(*) filter (where t.due_date is null or t.done_at::date <= t.due_date) / nullif(count(*), 0))
                        from public.tasks t where t.workspace_id = ws and t.done_at >= since and t.done_at < until),
      'overdue_now', (select count(*) from public.tasks t where t.workspace_id = ws and t.done_at is null and t.deleted_at is null and t.due_date < current_date),
      'open_now', (select count(*) from public.tasks t where t.workspace_id = ws and t.done_at is null and t.deleted_at is null),
      'stuck_now', (select count(*) from public.tasks t where t.workspace_id = ws and t.done_at is null and t.deleted_at is null
                    and coalesce((select max(e.created_at) from public.task_events e where e.task_id = t.id and e.field = 'status_id'), t.created_at) < now() - interval '7 days'),
      'reopened', (select count(*) from public.task_events e
                   join public.task_statuses a on a.id::text = e.old_value #>> '{}'
                   join public.task_statuses b on b.id::text = e.new_value #>> '{}'
                   where e.workspace_id = ws and e.field = 'status_id' and a.category = 'done' and b.category <> 'done'
                     and e.created_at >= since and e.created_at < until),
      'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', g::date,
                  'created', (select count(*) from public.tasks t where t.workspace_id = ws and t.created_at >= g and t.created_at < g + interval '7 days'),
                  'completed', (select count(*) from public.tasks t where t.workspace_id = ws and t.done_at >= g and t.done_at < g + interval '7 days'))
                  order by g), '[]'::jsonb)
                from generate_series(date_trunc('week', since), until, interval '7 days') g),
      'pages_created', (select count(*) from public.pages p where p.workspace_id = ws and p.created_at >= since and p.created_at < until),
      'pages_updated', (select count(*) from public.pages p where p.workspace_id = ws and p.updated_at >= since and p.updated_at < until),
      'stale_pages', (select count(*) from public.pages p where p.workspace_id = ws and p.deleted_at is null and p.updated_at < now() - interval '180 days'),
      'objects', (select coalesce(jsonb_object_agg(service, n), '{}'::jsonb) from (
                    select o.service, count(*) n from public.service_objects o where o.workspace_id = ws and o.created_at >= since and o.created_at < until
                    group by o.service) s),
      'survey_answers', (select count(*) from public.survey_responses r where r.workspace_id = ws and r.created_at >= since and r.created_at < until),
      'active_people', (select count(distinct x) from (
                          select e.actor_id x from public.task_events e where e.workspace_id = ws and e.created_at >= since and e.created_at < until
                          union select c.author_id from public.task_comments c where c.workspace_id = ws and c.created_at >= since and c.created_at < until
                          union select p.user_id from public.page_contributions p where p.workspace_id = ws and p.last_saved_at >= since and p.last_saved_at < until) s
                        where x is not null));
  end if;

  return jsonb_build_object('ok', true, 'admin', admin, 'people', people, 'team', team);
end;
$$;

revoke execute on function public.workspace_analytics(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.workspace_analytics(uuid, timestamptz, timestamptz) to authenticated;
