-- Undo the objects of the services (their content goes with them).
-- team_move_people goes back to its version from the tasks migration.
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
    union select reporter_id from public.tasks where workspace_id = ws
    union select assignee_id from public.tasks where workspace_id = ws
    union select updated_by from public.tasks where workspace_id = ws
    union select deleted_by from public.tasks where workspace_id = ws
    union select author_id from public.task_comments where workspace_id = ws
    union select actor_id from public.task_events where workspace_id = ws
    union select user_id from public.task_project_access where workspace_id = ws
    union select created_by from public.task_projects where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;

drop trigger if exists workspace_members_drop_object_access on public.workspace_members;
drop function if exists public.drop_object_access_of_removed_member();
drop function if exists public.set_service_object_group_role(uuid, uuid, text);
drop function if exists public.set_service_object_member_role(uuid, uuid, text);
drop function if exists public.set_service_object_workspace_role(uuid, text);
drop function if exists public.delete_service_object_forever(uuid);
drop function if exists public.trash_service_object(uuid, boolean);
drop function if exists public.save_service_object(uuid, text, jsonb, integer);
drop function if exists public.create_service_object(uuid, text, text, text, jsonb);
drop function if exists public.service_object_text(jsonb);
drop table if exists public.service_object_group_access;
drop table if exists public.service_object_access;
drop table if exists public.service_objects;
drop function if exists public.service_object_role(uuid);
drop function if exists public.service_object_role_of(uuid, uuid);
drop function if exists public.check_service_object_workspace();
