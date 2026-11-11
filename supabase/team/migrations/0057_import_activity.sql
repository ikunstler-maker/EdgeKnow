-- Rukh, package 3 (3б, first half): comments with their dates and authors and the tasks'
-- way through the columns come over from the tracker; a seated person's comments follow.
-- The same in supabase/migrations/20270112100000_import_activity.sql.
-- Rollback: supabase/team/rollbacks/0057_import_activity.down.sql

-- A comment and a history line can come from the tracker: each remembers the tracker's
-- person (a seat) behind it and its id there, so a second run changes instead of doubling.
alter table public.task_comments
  add column author_slot uuid references public.task_import_people (id) on delete set null,
  add column external_id text check (external_id is null or char_length(external_id) between 1 and 100);
create unique index task_comments_external_idx on public.task_comments (task_id, external_id) where external_id is not null;
create index task_comments_author_slot_idx on public.task_comments (author_slot) where author_slot is not null;
alter table public.task_events
  add column actor_slot uuid references public.task_import_people (id) on delete set null,
  add column external_id text check (external_id is null or char_length(external_id) between 1 and 100);
create unique index task_events_external_idx on public.task_events (task_id, external_id) where external_id is not null;
create index task_events_actor_slot_idx on public.task_events (actor_slot) where actor_slot is not null;

-- Nobody is told about comments an import brings.
drop trigger task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row when (coalesce(current_setting('ek.importing', true), '') <> 'on') execute function public.notify_task_comment();

-- The import brings what happened to the tasks (server only). Items: [{external_key,
-- comments: [{external_id, author_ext, body, created_at, edited_at}],
-- moves: [{external_id, actor_ext, from_status, to_status, at}]}]. Comments keep their dates
-- and authors; moves are the task's way through the columns with the tracker's dates (the
-- time spent in each column is counted from them). A second run replaces, never doubles.
create function public.import_task_activity(target_project uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.task_projects;
  item jsonb;
  entry jsonb;
  task uuid;
  seat public.task_import_people;
  comments integer := 0;
  moves integer := 0;
  missing integer := 0;
begin
  select * into project from public.task_projects where id = target_project;
  if project.id is null then
    return public.page_error('not_found');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    return public.page_error('invalid');
  end if;
  perform set_config('ek.importing', 'on', true);
  for item in select * from jsonb_array_elements(items) loop
    select t.id into task from public.tasks t where t.project_id = target_project and t.external_key = item ->> 'external_key';
    if task is null then
      missing := missing + 1;
      continue;
    end if;
    for entry in select * from jsonb_array_elements(coalesce(item -> 'comments', '[]'::jsonb)) with ordinality as x(value, n) where n <= 1000 loop
      if coalesce(entry ->> 'external_id', '') = '' or btrim(coalesce(entry ->> 'body', '')) = '' then
        continue;
      end if;
      seat := null;
      select * into seat from public.task_import_people p where p.project_id = target_project and p.external_id = entry ->> 'author_ext';
      insert into public.task_comments (workspace_id, task_id, author_id, author_slot, external_id, body, created_at, edited_at)
      values (project.workspace_id, task, seat.user_id, seat.id, left(entry ->> 'external_id', 100), left(btrim(entry ->> 'body'), 10000),
              coalesce((entry ->> 'created_at')::timestamptz, now()), (entry ->> 'edited_at')::timestamptz)
      on conflict (task_id, external_id) where external_id is not null do update set
        body = excluded.body, edited_at = excluded.edited_at, author_slot = excluded.author_slot,
        author_id = coalesce(public.task_comments.author_id, excluded.author_id);
      comments := comments + 1;
    end loop;
    if item ? 'moves' then
      delete from public.task_events e where e.task_id = task and e.external_id is not null and e.field = 'status_id';
      for entry in select * from jsonb_array_elements(item -> 'moves') with ordinality as x(value, n) where n <= 1000 loop
        if coalesce(entry ->> 'external_id', '') = ''
           or not exists (select 1 from public.task_statuses s where s.project_id = target_project and s.id = (entry ->> 'to_status')::uuid) then
          continue;
        end if;
        seat := null;
        select * into seat from public.task_import_people p where p.project_id = target_project and p.external_id = entry ->> 'actor_ext';
        insert into public.task_events (workspace_id, task_id, actor_id, actor_slot, external_id, field, old_value, new_value, created_at)
        values (project.workspace_id, task, seat.user_id, seat.id, left(entry ->> 'external_id', 100), 'status_id',
                to_jsonb(entry ->> 'from_status'), to_jsonb(entry ->> 'to_status'), coalesce((entry ->> 'at')::timestamptz, now()))
        on conflict (task_id, external_id) where external_id is not null do nothing;
        moves := moves + 1;
      end loop;
    end if;
  end loop;
  perform set_config('ek.importing', '', true);
  return jsonb_build_object('ok', true, 'comments', comments, 'moves', moves, 'missing', missing);
end;
$$;
revoke execute on function public.import_task_activity(uuid, jsonb) from public, anon, authenticated;

-- Seating a person hands over their comments and history lines as well as their tasks.
create or replace function public.seat_import_person(target_person uuid, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.task_import_people;
  previous uuid;
  held integer;
  wrote integer;
  said integer;
begin
  select * into person from public.task_import_people where id = target_person for update;
  if person.id is null
     or not (coalesce(public.task_project_role(person.project_id) = 'owner', false) or coalesce(public.is_workspace_admin(person.workspace_id), false)) then
    return public.page_error('forbidden');
  end if;
  if member is not null and not public.is_active_member(person.workspace_id, member) then
    return public.page_error('not_a_member');
  end if;
  previous := person.user_id;
  perform set_config('ek.importing', 'on', true);
  perform set_config('ek.by_rule', 'on', true);
  update public.tasks set assignee_id = member, imported_assignee = case when member is null then person.name end
  where assignee_slot = person.id and assignee_id is not distinct from previous;
  get diagnostics held = row_count;
  update public.tasks set reporter_id = member, imported_reporter = case when member is null then person.name end
  where reporter_slot = person.id and reporter_id is not distinct from previous;
  get diagnostics wrote = row_count;
  -- The person's comments and history lines go with the seat too.
  update public.task_comments set author_id = member where author_slot = person.id and author_id is not distinct from previous;
  get diagnostics said = row_count;
  update public.task_events set actor_id = member where actor_slot = person.id and actor_id is not distinct from previous;
  perform set_config('ek.importing', '', true);
  perform set_config('ek.by_rule', '', true);
  update public.task_import_people set user_id = member, seated_by = auth.uid(), seated_at = case when member is not null then now() end
  where id = person.id returning * into person;
  perform public.grant_import_role(person);
  return jsonb_build_object('ok', true, 'assigned', held, 'reported', wrote, 'comments', said);
end;
$$;
