-- Undo 20261120100000_tasks.sql: projects, tasks, comments and their history go.
CREATE OR REPLACE FUNCTION public.team_move_people(ws uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ids as (
    select owner_id as id from public.pages where workspace_id = ws
    union select created_by from public.pages where workspace_id = ws
    union select updated_by from public.pages where workspace_id = ws
    union select deleted_by from public.pages where workspace_id = ws
    union select user_id from public.page_access where workspace_id = ws
    union select granted_by from public.page_access where workspace_id = ws
    union select created_by from public.comment_threads where workspace_id = ws
    union select resolved_by from public.comment_threads where workspace_id = ws
    union select author_id from public.comments where workspace_id = ws
    union select uploaded_by from public.attachments where workspace_id = ws
    union select user_id from public.page_mentions where workspace_id = ws
    union select mentioned_by from public.page_mentions where workspace_id = ws
    union select user_id from public.page_contributions where workspace_id = ws
    union select actor_id from public.audit_log where workspace_id = ws
    union select user_id from public.workspace_members where workspace_id = ws
    union select owner_id from public.workspaces where id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
drop trigger if exists workspace_members_drop_task_access on public.workspace_members;
drop function if exists public.drop_task_access_of_removed_member();
drop function if exists public.edit_task_comment(uuid, text, boolean);
drop function if exists public.add_task_comment(uuid, text, uuid[]);
drop function if exists public.delete_task(uuid, boolean);
drop function if exists public.update_task(uuid, jsonb);
drop function if exists public.create_task(uuid, jsonb);
drop function if exists public.task_fields_valid(uuid, jsonb);
drop function if exists public.set_task_project_group_role(uuid, uuid, text);
drop function if exists public.set_task_project_member_role(uuid, uuid, text);
drop function if exists public.update_task_project(uuid, jsonb);
drop function if exists public.create_task_project(uuid, text, text, text, text[]);
drop table if exists public.task_events, public.task_comments, public.tasks, public.task_statuses,
  public.task_project_group_access, public.task_project_access, public.task_projects;
drop function if exists public.record_task_events();
drop function if exists public.task_project_role(uuid);
drop function if exists public.task_project_role_of(uuid, uuid);
drop function if exists public.check_task_comment_workspace();
drop function if exists public.check_task_workspace();
