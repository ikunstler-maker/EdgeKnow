-- Path C, step 1.7b: moving a workspace that already has pages into its team's
-- own database.
--
-- The move is part of the connection setup: after the member sync come "copy"
-- (in small portions, recorded in setup_progress so a failed call resumes) and
-- "verify" (counts and page contents must match exactly). Until it is done the
-- workspace stays readable from the central database but refuses changes. The
-- central rows are left untouched, so cancelling or undoing is one step.
-- Rollback: supabase/rollbacks/20261111100000_team_move.down.sql

alter table public.team_databases drop constraint team_databases_setup_step_check;
alter table public.team_databases
  add constraint team_databases_setup_step_check
    check (setup_step in ('project', 'schema', 'keys', 'sync', 'copy', 'verify', 'sign_in', 'done')),
  add column setup_progress jsonb,
  -- When the workspace's existing data was copied in, and the counts of the check.
  add column moved_at timestamptz,
  add column move_report jsonb;

-- Everyone the workspace's data points to (authors, owners, people with access,
-- commenters, former members too), so their names exist in the team database.
create function public.team_move_people(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.team_move_people(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.team_move_people(uuid) to service_role;
  end if;
end;
$$;
