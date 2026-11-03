-- Surveys, step О3: a link for anyone (no account needed) and files in answers.
-- Everything through the link goes through EdgeKnow's server (secret key) only:
-- nothing here is open to the "anon" role. The same in supabase/team/migrations/0023_survey_public.sql.
-- Rollback: supabase/rollbacks/20261206100000_survey_public.down.sql

-- A link for anyone (no account needed), with the database's own limits; files in answers.

alter table public.survey_settings
  add column public_enabled boolean not null default false,
  add column public_token   text unique check (public_token ~ '^[0-9a-f]{32}$');
alter table public.survey_responses
  -- Sent through the link for anyone (never tied to an account of this workspace).
  add column public           boolean not null default false,
  -- Someone signed in to EdgeKnow who answered through that link (named surveys only).
  add column respondent_name  text check (char_length(respondent_name) <= 200),
  add column respondent_email text check (char_length(respondent_email) <= 320);
create index survey_responses_email_idx on public.survey_responses (object_id, respondent_email) where respondent_email is not null;

-- Answers through the link, counted per visitor (a hash the server makes; no address is kept) for the limits.
create table public.survey_public_hits (
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  visitor       text not null check (visitor ~ '^[0-9a-f]{64}$'),
  at            timestamptz not null default now()
);
create index survey_public_hits_idx on public.survey_public_hits (object_id, at);
alter table public.survey_public_hits enable row level security;
revoke all on public.survey_public_hits from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.survey_public_hits to service_role;
  end if;
end $$;
create trigger survey_public_hits_same_workspace before insert or update on public.survey_public_hits
  for each row execute function public.check_survey_workspace();

-- Files of survey answers live with the board pictures (the same one storage):
-- documents too, still up to 4 MB.
alter table public.object_files drop constraint object_files_mime_type_check;
alter table public.object_files add constraint object_files_mime_type_check check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
-- A survey's files: seen by those who see its answers, and by whoever added them.
drop policy "Members see the pictures of objects open to them" on public.object_files;
create policy "Members see the pictures of objects open to them"
  on public.object_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null
         and (not exists (select 1 from public.service_objects o where o.id = object_id and o.service = 'surveys')
              or public.can_read_survey_answers(object_id) or uploaded_by = auth.uid()));

create or replace function public.survey_clean_answers(content jsonb, answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  sections jsonb := case when jsonb_typeof(content -> 'sections') = 'array' then content -> 'sections' else '[]'::jsonb end;
  total integer := jsonb_array_length(sections);
  at integer := 0;
  steps integer := 0;
  section jsonb;
  question jsonb;
  qid text;
  kind text;
  answer jsonb;
  jump text;
  next_step text;
  labels text[];
  picked text[];
  low integer;
  high integer;
  clean jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(answers) is distinct from 'object' or pg_column_size(answers) > 262144 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  while at < total and steps <= total loop
    steps := steps + 1;
    section := sections -> at;
    jump := null;
    for question in select value from jsonb_array_elements(case when jsonb_typeof(section -> 'questions') = 'array' then section -> 'questions' else '[]'::jsonb end) loop
      qid := question ->> 'id';
      kind := question ->> 'type';
      continue when qid is null or kind is null;
      answer := answers -> qid;
      if answer is null or answer = 'null'::jsonb
         or (jsonb_typeof(answer) = 'string' and btrim(answer #>> '{}') = '')
         or (jsonb_typeof(answer) = 'array' and jsonb_array_length(answer) = 0) then
        if coalesce((question ->> 'required')::boolean, false) then
          return jsonb_build_object('ok', false, 'error', 'required', 'question', qid);
        end if;
        continue;
      end if;
      select coalesce(array_agg(o ->> 'label'), '{}') into labels from jsonb_array_elements(
        case when jsonb_typeof(question -> 'options') = 'array' then question -> 'options' else '[]'::jsonb end) o;
      if kind in ('short', 'long') then
        high := case when kind = 'short' then 500 else 5000 end;
        if jsonb_typeof(answer) <> 'string' or char_length(answer #>> '{}') > high then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
        answer := to_jsonb(btrim(answer #>> '{}'));
      elsif kind in ('single', 'dropdown') then
        if jsonb_typeof(answer) <> 'string' or not ((answer #>> '{}') = any (labels)) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
        select o ->> 'goTo' into next_step from jsonb_array_elements(question -> 'options') o where o ->> 'label' = answer #>> '{}' limit 1;
        if next_step is not null and next_step <> '' then
          jump := next_step;
        end if;
      elsif kind = 'multi' then
        if jsonb_typeof(answer) <> 'array' then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
        select array_agg(distinct v #>> '{}') into picked from jsonb_array_elements(answer) v;
        if exists (select 1 from jsonb_array_elements(answer) v where jsonb_typeof(v) <> 'string')
           or not (picked <@ labels) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
        -- In the order of the form.
        answer := (select coalesce(jsonb_agg(l order by n), '[]'::jsonb) from unnest(labels) with ordinality u(l, n) where l = any (picked));
      elsif kind in ('scale', 'rating') then
        low := case when kind = 'rating' then 1 else coalesce((question ->> 'min')::integer, 1) end;
        high := coalesce((question ->> 'max')::integer, case when kind = 'rating' then 5 else 10 end);
        if jsonb_typeof(answer) <> 'number' or (answer #>> '{}')::numeric <> trunc((answer #>> '{}')::numeric)
           or (answer #>> '{}')::numeric not between low and high then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
      elsif kind = 'date' then
        if jsonb_typeof(answer) <> 'string' or (answer #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
        begin
          perform (answer #>> '{}')::date;
        exception when others then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end;
      elsif kind = 'file' then
        -- Files added through the upload (up to 5): their ids; the survey's own files are checked by the caller.
        if jsonb_typeof(answer) <> 'array' or jsonb_array_length(answer) > 5
           or exists (select 1 from jsonb_array_elements(answer) v where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'question', qid);
        end if;
      else
        continue;
      end if;
      clean := clean || jsonb_build_object(qid, answer);
    end loop;
    next_step := coalesce(jump, nullif(section ->> 'next', ''), 'continue');
    exit when next_step = 'submit';
    if next_step = 'continue' then
      at := at + 1;
    else
      select n - 1 into at from jsonb_array_elements(sections) with ordinality s(value, n) where s.value ->> 'id' = next_step;
      at := coalesce(at, total);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'answers', clean);
end;
$$;

-- Every file named in the answers was added to this survey.
create function public.survey_files_ok(target_object uuid, answers jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(exists (select 1 from public.object_files f where f.id = (v #>> '{}')::uuid and f.object_id = target_object)), true)
  from public.service_objects o,
       jsonb_array_elements(case when jsonb_typeof(o.data -> 'sections') = 'array' then o.data -> 'sections' else '[]'::jsonb end) s,
       jsonb_array_elements(case when jsonb_typeof(s.value -> 'questions') = 'array' then s.value -> 'questions' else '[]'::jsonb end) q,
       jsonb_array_elements(case when jsonb_typeof(answers -> (q.value ->> 'id')) = 'array' then answers -> (q.value ->> 'id') else '[]'::jsonb end) v
  where o.id = target_object and q.value ->> 'type' = 'file';
$$;

create or replace function public.survey_sheet_put(target_object uuid, target_response uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  sheet public.service_objects;
  survey public.service_objects;
  response public.survey_responses;
  tabs jsonb;
  tab jsonb;
  tab_at integer;
  cells jsonb;
  columns jsonb;
  next_col integer;
  question jsonb;
  answer jsonb;
  row_at integer;
  head jsonb := '[]'::jsonb;
  line jsonb := '[]'::jsonb;
  written integer[] := '{}';
  person text;
  new_data jsonb;
begin
  select * into st from public.survey_settings where object_id = target_object;
  if st.sheet_id is null then
    return;
  end if;
  select * into sheet from public.service_objects where id = st.sheet_id and service = 'sheets' and deleted_at is null for update;
  if not found then
    return;
  end if;
  select * into survey from public.service_objects where id = target_object;
  select * into response from public.survey_responses where id = target_response;
  if response.id is null then
    return;
  end if;

  tabs := case when jsonb_typeof(sheet.data -> 'sheets') = 'array' then sheet.data -> 'sheets' else '[]'::jsonb end;
  select n - 1 into tab_at from jsonb_array_elements(tabs) with ordinality t(value, n) where t.value ->> 'name' = st.sheet_name limit 1;
  if tab_at is null then
    tabs := tabs || jsonb_build_array(jsonb_build_object('name', st.sheet_name, 'order', jsonb_array_length(tabs), 'row', 100, 'column', 26,
                                                         'celldata', '[]'::jsonb, 'config', '{}'::jsonb, 'status', 0));
    tab_at := jsonb_array_length(tabs) - 1;
  end if;
  tab := tabs -> tab_at;
  cells := case when jsonb_typeof(tab -> 'celldata') = 'array' then tab -> 'celldata' else '[]'::jsonb end;

  columns := st.sheet_columns;
  select coalesce(max((value #>> '{}')::integer) + 1, 2) into next_col from jsonb_each(columns);
  head := jsonb_build_array(public.survey_cell(0, 0, coalesce(st.sheet_labels -> 'time', '"Time"')),
                            public.survey_cell(0, 1, coalesce(st.sheet_labels -> 'person', '"Person"')));
  written := array[0, 1];
  row_at := coalesce(response.sheet_row,
                     (select greatest(coalesce(max((c ->> 'r')::integer), 0) + 1, 1) from jsonb_array_elements(cells) c));
  if response.user_id is not null then
    select coalesce(nullif(p.name, ''), p.email) into person from public.profiles p where p.id = response.user_id;
  end if;
  line := jsonb_build_array(
    public.survey_cell(row_at, 0, to_jsonb(to_char(response.updated_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI'))),
    public.survey_cell(row_at, 1, to_jsonb(coalesce(person, response.respondent_name, response.respondent_email, st.sheet_labels ->> 'anonymous', ''))));

  for question in select q.value from jsonb_array_elements(case when jsonb_typeof(survey.data -> 'sections') = 'array' then survey.data -> 'sections' else '[]'::jsonb end) s,
                    jsonb_array_elements(case when jsonb_typeof(s.value -> 'questions') = 'array' then s.value -> 'questions' else '[]'::jsonb end) q loop
    continue when question ->> 'id' is null;
    if not columns ? (question ->> 'id') then
      columns := columns || jsonb_build_object(question ->> 'id', next_col);
      next_col := next_col + 1;
    end if;
    head := head || jsonb_build_array(public.survey_cell(0, (columns ->> (question ->> 'id'))::integer, to_jsonb(coalesce(question ->> 'title', ''))));
    written := written || (columns ->> (question ->> 'id'))::integer;
    answer := response.answers -> (question ->> 'id');
    if jsonb_typeof(answer) = 'array' and question ->> 'type' = 'file' then
      answer := to_jsonb(coalesce((select string_agg(f.name, ', ') from jsonb_array_elements_text(answer) v join public.object_files f on f.id = v::uuid), ''));
    elsif jsonb_typeof(answer) = 'array' then
      answer := to_jsonb((select string_agg(v #>> '{}', ', ') from jsonb_array_elements(answer) v));
    elsif jsonb_typeof(answer) = 'string' and question ->> 'type' = 'date' then
      answer := to_jsonb(to_char(to_date(answer #>> '{}', 'YYYY-MM-DD'), 'DD.MM.YYYY'));
    end if;
    if answer is not null then
      line := line || jsonb_build_array(public.survey_cell(row_at, (columns ->> (question ->> 'id'))::integer, answer));
    end if;
  end loop;

  -- The header cells written now and the whole row of this answer are replaced.
  select coalesce(jsonb_agg(c), '[]'::jsonb) into cells from jsonb_array_elements(cells) c
  where not ((c ->> 'r')::integer = row_at or ((c ->> 'r')::integer = 0 and (c ->> 'c')::integer = any (written)));
  cells := cells || head || line;
  tab := tab || jsonb_build_object('celldata', cells,
                                   'row', greatest(coalesce((tab ->> 'row')::integer, 100), row_at + 20),
                                   'column', greatest(coalesce((tab ->> 'column')::integer, 26), next_col + 1));
  new_data := jsonb_set(case when jsonb_typeof(sheet.data) = 'object' then sheet.data else '{}'::jsonb end, '{sheets}', jsonb_set(tabs, array[tab_at::text], tab));
  if pg_column_size(new_data) > 1048576 then
    update public.survey_settings set sheet_full = true where object_id = target_object;
    return;
  end if;
  -- Who changed the table is not written: for an anonymous survey it would tell who answered.
  update public.service_objects set data = new_data, search_text = public.service_object_text(new_data), version = version + 1, updated_at = now()
  where id = sheet.id;
  update public.survey_responses set sheet_row = row_at where id = target_response;
  update public.survey_settings set sheet_columns = columns where object_id = target_object;
end;
$$;

create or replace function public.survey_state(target_object uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  survey public.service_objects;
  st public.survey_settings;
  manager boolean := public.can_read_survey_answers(target_object);
  total integer;
  answered boolean;
  mine public.survey_responses;
  sheet_title text;
begin
  select * into survey from public.service_objects where id = target_object and service = 'surveys' and deleted_at is null;
  if not found or public.service_object_role(target_object) is null then
    return public.page_error('forbidden');
  end if;
  select * into st from public.survey_settings where object_id = target_object;
  total := (select count(*) from public.survey_responses r where r.object_id = target_object);
  answered := exists (select 1 from public.survey_respondents r where r.object_id = target_object and r.user_id = auth.uid());
  if not coalesce(st.anonymous, false) then
    select * into mine from public.survey_responses r where r.object_id = target_object and r.user_id = auth.uid() order by r.created_at desc limit 1;
  end if;
  if manager and st.sheet_id is not null and public.service_object_role(st.sheet_id) is not null then
    select o.title into sheet_title from public.service_objects o where o.id = st.sheet_id and o.deleted_at is null;
  end if;
  return jsonb_build_object(
    'ok', true,
    'anonymous', coalesce(st.anonymous, false),
    'once', coalesce(st.once, true),
    'editable', coalesce(st.editable, false),
    'accepting', coalesce(st.accepting, true),
    'closes_at', st.closes_at,
    'max_responses', st.max_responses,
    'closed', not coalesce(st.accepting, true) or coalesce(st.closes_at <= now(), false) or total >= coalesce(st.max_responses, 10000),
    'answered', answered,
    'mine', case when mine.id is not null and coalesce(st.once, true) and coalesce(st.editable, false) then mine.answers end,
    'manager', manager,
    'count', case when manager then total end,
    'public', case when manager then jsonb_build_object('enabled', coalesce(st.public_enabled, false), 'token', st.public_token) end,
    'sheet', case when manager and st.sheet_id is not null then jsonb_build_object('id', st.sheet_id, 'title', sheet_title, 'name', st.sheet_name, 'full', st.sheet_full) end
  );
end;
$$;

create or replace function public.submit_survey_response(target_object uuid, answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  survey public.service_objects;
  st public.survey_settings;
  checked jsonb;
  existing uuid;
  response_id uuid;
  total integer;
begin
  select * into survey from public.service_objects where id = target_object and service = 'surveys' and deleted_at is null;
  if not found or public.service_object_role(target_object) is null then
    return public.page_error('forbidden');
  end if;
  -- One answer at a time per survey (the count and the table's next row stay right).
  perform 1 from public.service_objects where id = target_object for update;
  select * into st from public.survey_settings where object_id = target_object;
  if not coalesce(st.anonymous, false) then
    select r.id into existing from public.survey_responses r where r.object_id = target_object and r.user_id = auth.uid() order by r.created_at desc limit 1;
  end if;
  total := (select count(*) from public.survey_responses r where r.object_id = target_object);
  if not coalesce(st.accepting, true) or coalesce(st.closes_at <= now(), false)
     or (total >= coalesce(st.max_responses, 10000) and not (existing is not null and coalesce(st.once, true) and coalesce(st.editable, false))) then
    return public.page_error('closed');
  end if;
  checked := public.survey_clean_answers(survey.data, answers);
  if not (checked ->> 'ok')::boolean then
    return checked;
  end if;
  if not public.survey_files_ok(target_object, checked -> 'answers') then
    return public.page_error('invalid');
  end if;
  if coalesce(st.once, true) and exists (select 1 from public.survey_respondents r where r.object_id = target_object and r.user_id = auth.uid()) then
    if coalesce(st.anonymous, false) or existing is null or not coalesce(st.editable, false) then
      return public.page_error('already_answered');
    end if;
    update public.survey_responses set answers = checked -> 'answers', updated_at = now() where id = existing;
    response_id := existing;
  else
    insert into public.survey_responses (object_id, workspace_id, user_id, answers)
    values (target_object, survey.workspace_id, case when coalesce(st.anonymous, false) then null else auth.uid() end, checked -> 'answers')
    returning id into response_id;
    insert into public.survey_respondents (object_id, workspace_id, user_id) values (target_object, survey.workspace_id, auth.uid())
    on conflict do nothing;
  end if;
  perform public.survey_sheet_put(target_object, response_id);
  return jsonb_build_object('ok', true, 'edited', coalesce(response_id = existing, false));
end;
$$;

create or replace function public.survey_answers(target_object uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_survey_answers(target_object) then
    return public.page_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'responses', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'updated_at', r.updated_at, 'answers', r.answers,
                                        'name', coalesce(p.name, r.respondent_name), 'email', coalesce(p.email, r.respondent_email), 'public', r.public) order by r.created_at)
    from public.survey_responses r left join public.profiles p on p.id = r.user_id
    where r.object_id = target_object), '[]'::jsonb),
    'files', coalesce((select jsonb_object_agg(f.id, jsonb_build_object('name', f.name, 'bytes', f.bytes)) from public.object_files f where f.object_id = target_object), '{}'::jsonb));
end;
$$;

-- The link for anyone: on or off, or a new one (the old one stops working): those who see the answers.
create function public.set_survey_public(target_object uuid, enabled boolean, renew boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  token text;
begin
  if ws is null or not public.can_read_survey_answers(target_object) then
    return public.page_error('forbidden');
  end if;
  insert into public.survey_settings as s (object_id, workspace_id, public_enabled, public_token, updated_by, updated_at)
  values (target_object, ws, coalesce(enabled, false), replace(gen_random_uuid()::text, '-', ''), auth.uid(), now())
  on conflict (object_id) do update
    set public_enabled = coalesce(enabled, s.public_enabled),
        public_token = case when renew or s.public_token is null then replace(gen_random_uuid()::text, '-', '') else s.public_token end,
        updated_by = auth.uid(), updated_at = now()
  returning public_token into token;
  return jsonb_build_object('ok', true, 'token', token, 'enabled', coalesce(enabled, false));
end;
$$;

-- Only EdgeKnow's server (secret key) reaches the survey behind a link; it checks
-- the "not a robot" test and counts the visitor before asking.
create function public.public_survey(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  survey public.service_objects;
  total integer;
begin
  select * into st from public.survey_settings s where s.public_token = token and s.public_enabled;
  if not found then
    return public.page_error('not_found');
  end if;
  select * into survey from public.service_objects o where o.id = st.object_id and o.deleted_at is null;
  if not found then
    return public.page_error('not_found');
  end if;
  total := (select count(*) from public.survey_responses r where r.object_id = st.object_id);
  return jsonb_build_object('ok', true, 'id', survey.id, 'workspace_id', survey.workspace_id, 'title', survey.title, 'data', survey.data,
    'anonymous', st.anonymous, 'once', st.once,
    'closed', not st.accepting or coalesce(st.closes_at <= now(), false) or total >= coalesce(st.max_responses, 10000));
end;
$$;

create function public.submit_public_survey_response(token text, answers jsonb, visitor text, person_name text, person_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  survey public.service_objects;
  checked jsonb;
  response_id uuid;
  named boolean;
begin
  select * into st from public.survey_settings s where s.public_token = token and s.public_enabled;
  if not found or visitor is null or visitor !~ '^[0-9a-f]{64}$' then
    return public.page_error('not_found');
  end if;
  select * into survey from public.service_objects o where o.id = st.object_id and o.deleted_at is null;
  if not found then
    return public.page_error('not_found');
  end if;
  perform 1 from public.service_objects where id = survey.id for update;
  if not st.accepting or coalesce(st.closes_at <= now(), false)
     or (select count(*) from public.survey_responses r where r.object_id = survey.id) >= coalesce(st.max_responses, 10000) then
    return public.page_error('closed');
  end if;
  -- Up to 5 answers from one visitor in 10 minutes, and 300 an hour for the whole survey.
  if (select count(*) from public.survey_public_hits h where h.object_id = survey.id and h.visitor = submit_public_survey_response.visitor and h.at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.survey_public_hits h where h.object_id = survey.id and h.at > now() - interval '1 hour') >= 300 then
    return public.page_error('rate_limited');
  end if;
  checked := public.survey_clean_answers(survey.data, answers);
  if not (checked ->> 'ok')::boolean then
    return checked;
  end if;
  if not public.survey_files_ok(survey.id, checked -> 'answers') then
    return public.page_error('invalid');
  end if;
  named := not st.anonymous and nullif(btrim(coalesce(person_email, '')), '') is not null;
  if st.once and named and exists (select 1 from public.survey_responses r where r.object_id = survey.id and lower(r.respondent_email) = lower(btrim(person_email))) then
    return public.page_error('already_answered');
  end if;
  insert into public.survey_public_hits (object_id, workspace_id, visitor) values (survey.id, survey.workspace_id, submit_public_survey_response.visitor);
  delete from public.survey_public_hits h where h.object_id = survey.id and h.at < now() - interval '1 day';
  insert into public.survey_responses (object_id, workspace_id, user_id, answers, public, respondent_name, respondent_email)
  values (survey.id, survey.workspace_id, null, checked -> 'answers', true,
          case when named then left(nullif(btrim(person_name), ''), 200) end, case when named then left(btrim(person_email), 320) end)
  returning id into response_id;
  perform public.survey_sheet_put(survey.id, response_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- Step 1 of adding a file to an answer (everyone who can answer, while the survey
-- is open): a record and its path; the server then stores the bytes.
create function public.register_survey_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  st public.survey_settings;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if ws is null or public.service_object_role(target_object) is null then
    return public.page_error('forbidden');
  end if;
  select * into st from public.survey_settings where object_id = target_object;
  if not coalesce(st.accepting, true) or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object and f.uploaded_by = auth.uid() and f.created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.object_files f where f.object_id = target_object) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

-- The same through the link for anyone (EdgeKnow's server, for someone signed in).
create function public.register_public_survey_file(token text, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  ws uuid;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into st from public.survey_settings s where s.public_token = token and s.public_enabled;
  ws := (select o.workspace_id from public.service_objects o where o.id = st.object_id and o.deleted_at is null);
  if ws is null then
    return public.page_error('not_found');
  end if;
  if not st.accepting or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = st.object_id and f.created_at > now() - interval '1 hour') >= 300
     or (select count(*) from public.object_files f where f.object_id = st.object_id) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || st.object_id || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, st.object_id, btrim(file_name), file_type, file_bytes, path, null);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

-- Files added to a survey but never sent with an answer go after a day (the nightly cleanup).
create function public.clean_survey_files()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.object_files f
  using public.service_objects o
  where o.id = f.object_id and o.service = 'surveys' and f.created_at < now() - interval '1 day'
    and not exists (select 1 from public.survey_responses r, jsonb_each(r.answers) a
                    where r.object_id = f.object_id and jsonb_typeof(a.value) = 'array' and a.value ? f.id::text);
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke execute on function public.survey_files_ok(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.set_survey_public(uuid, boolean, boolean) from public, anon;
revoke execute on function public.register_survey_file(uuid, text, text, integer) from public, anon;
revoke execute on function public.public_survey(text) from public, anon, authenticated;
revoke execute on function public.submit_public_survey_response(text, jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.register_public_survey_file(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.clean_survey_files() from public, anon, authenticated;
-- The files' read rule asks it for the person reading (it only says yes or no about themselves).
grant execute on function public.can_read_survey_answers(uuid) to authenticated;
grant execute on function public.set_survey_public(uuid, boolean, boolean) to authenticated;
grant execute on function public.register_survey_file(uuid, text, text, integer) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.public_survey(text) to service_role;
    grant execute on function public.submit_public_survey_response(text, jsonb, text, text, text) to service_role;
    grant execute on function public.register_public_survey_file(text, text, text, integer) to service_role;
    grant execute on function public.clean_survey_files() to service_role;
  end if;
end $$;
