-- Undo 0006_tasks.sql: projects, tasks, comments and their history go.
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
