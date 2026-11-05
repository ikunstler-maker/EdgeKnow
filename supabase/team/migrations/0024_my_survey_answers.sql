-- My data: own survey answers, in a team's own database (as supabase/migrations/20261208100000_my_survey_answers.sql).
-- Rollback: supabase/team/rollbacks/0024_my_survey_answers.down.sql

-- "My data": a person's own named survey answers in a workspace (anonymous
-- answers carry no name, so they are never theirs to take). Answers given
-- through a link for anyone while signed in match by their email.
create function public.my_survey_answers(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'survey_id', o.id, 'survey', o.title, 'answers', r.answers,
           'through_link', r.public, 'created_at', r.created_at, 'updated_at', r.updated_at)
         order by r.created_at), '[]'::jsonb)
  from public.survey_responses r
  join public.service_objects o on o.id = r.object_id
  where r.workspace_id = ws
    and public.is_workspace_member(ws)
    and (r.user_id = auth.uid()
         or lower(r.respondent_email) = (select lower(p.email) from public.profiles p where p.id = auth.uid()));
$$;

revoke execute on function public.my_survey_answers(uuid) from public, anon;
grant execute on function public.my_survey_answers(uuid) to authenticated;
