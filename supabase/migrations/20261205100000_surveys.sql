-- Surveys, steps О1, О2 and О4: the service "surveys" (kind "survey", a form) in the
-- shared objects table; answers, who answered and how the survey takes answers in
-- their own tables, read and changed only through the functions here; each answer
-- may also become a row of a connected table.
-- The same in supabase/team/migrations/0022_surveys.sql.
-- Rollback: supabase/rollbacks/20261205100000_surveys.down.sql

-- Surveys may be created too. A new survey is open to the whole workspace only for
-- answering ("viewer"): its answers are seen by those who manage it, not by everyone.
create or replace function public.create_service_object(ws uuid, target_service text, new_kind text, new_title text, new_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  -- "Own database first": as for pages.
  if not public.central_pages_allowed(ws) then
    return public.page_error('team_database_required');
  end if;
  if not ((target_service = 'nodes' and new_kind in ('mindmap', 'flow')) or (target_service = 'boards' and new_kind = 'board')
          or (target_service = 'sheets' and new_kind = 'sheet') or (target_service = 'surveys' and new_kind = 'survey')) then
    return public.page_error('invalid');
  end if;
  if char_length(coalesce(new_title, '')) > 200 then
    return public.page_error('title_too_long');
  end if;
  if pg_column_size(coalesce(new_data, '{}'::jsonb)) > 1048576 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.service_objects o where o.workspace_id = ws and o.deleted_at is null) >= 5000 then
    return public.page_error('too_many');
  end if;
  insert into public.service_objects (workspace_id, service, kind, title, data, search_text, owner_id, created_by, updated_by, workspace_role)
  values (ws, target_service, new_kind, btrim(coalesce(new_title, '')), coalesce(new_data, '{}'::jsonb),
          public.service_object_text(new_data), case when guest then public.workspace_owner_of(ws) else auth.uid() end, auth.uid(), auth.uid(),
          case when target_service = 'surveys' then 'viewer' else 'editor' end)
  returning id into new_id;
  -- A guest's map or board belongs to the workspace owner; the guest edits it.
  if guest then
    insert into public.service_object_access (object_id, workspace_id, user_id, role, granted_by)
    values (new_id, ws, auth.uid(), 'editor', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'version', 1);
end;
$$;

-- What search reads from an object: also a survey's sections, questions and choices.
create or replace function public.service_object_text(content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(string_agg(value #>> '{}', ' '), ''), 20000)
  from (
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.nodes[*].description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.edges[*].label') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).text') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.elements[*] ? (!(@.isDeleted == true)).name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].name') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sheets[*].celldata[*].v.m') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.description') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].title') value
    union all
    select value from jsonb_path_query(coalesce(content, '{}'::jsonb), 'lax $.sections[*].questions[*].options[*].label') value
  ) parts
  where jsonb_typeof(value) = 'string' and value #>> '{}' <> '';
$$;
revoke execute on function public.service_object_text(jsonb) from public, anon;

-- How a survey takes answers. No row: the defaults (named, once, open).
create table public.survey_settings (
  object_id      uuid primary key references public.service_objects (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  -- Anonymous: who answered is never written next to the answer (not even for the owner).
  anonymous      boolean not null default false,
  -- Once: one answer per person; editable: that person may change it later (named only).
  once           boolean not null default true,
  editable       boolean not null default false,
  accepting      boolean not null default true,
  closes_at      timestamptz,
  max_responses  integer check (max_responses between 1 and 10000),
  -- The connected table: each answer is a row on its sheet `sheet_name`.
  sheet_id       uuid references public.service_objects (id) on delete set null,
  sheet_name     text check (char_length(sheet_name) between 1 and 60),
  -- Question id -> column (0 is the time, 1 the person); headers in the interface language.
  sheet_columns  jsonb not null default '{}'::jsonb,
  sheet_labels   jsonb not null default '{}'::jsonb,
  -- The table reached its size limit: new answers are kept here but not added there.
  sheet_full     boolean not null default false,
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);
create table public.survey_responses (
  id            uuid primary key default gen_random_uuid(),
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- Empty for an anonymous survey.
  user_id       uuid references public.profiles (id) on delete set null,
  answers       jsonb not null default '{}'::jsonb,
  -- Its row in the connected table (to change it there when the answer changes).
  sheet_row     integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index survey_responses_object_idx on public.survey_responses (object_id, created_at);
create index survey_responses_user_idx on public.survey_responses (object_id, user_id) where user_id is not null;
-- Who has answered (for "once"), kept apart from the answers and without a time,
-- so an anonymous answer can't be matched to its person.
create table public.survey_respondents (
  object_id     uuid not null references public.service_objects (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  primary key (object_id, user_id)
);

-- Read and changed only through the functions below.
alter table public.survey_settings enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_respondents enable row level security;
revoke all on public.survey_settings from public, anon, authenticated;
revoke all on public.survey_responses from public, anon, authenticated;
revoke all on public.survey_respondents from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.survey_settings, public.survey_responses, public.survey_respondents to service_role;
  end if;
end $$;

create function public.check_survey_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select o.workspace_id from public.service_objects o where o.id = new.object_id and o.service = 'surveys') then
    raise exception 'answer and survey must be in the same workspace';
  end if;
  return new;
end;
$$;
create trigger survey_settings_same_workspace before insert or update on public.survey_settings
  for each row execute function public.check_survey_workspace();
create trigger survey_responses_same_workspace before insert or update on public.survey_responses
  for each row execute function public.check_survey_workspace();
create trigger survey_respondents_same_workspace before insert or update on public.survey_respondents
  for each row execute function public.check_survey_workspace();

-- Who sees the answers: those who edit the survey, except guests.
create function public.can_read_survey_answers(target_object uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_rank(public.service_object_role(target_object)) >= public.role_rank('editor')
                  and not public.is_guest(o.workspace_id, auth.uid()), false)
  from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null;
$$;

-- An answer checked against the form: the sections are walked as the person saw
-- them (a choice may send to another section or to the end), required questions
-- must be answered, and only answers to the questions on that path are kept.
create function public.survey_clean_answers(content jsonb, answers jsonb)
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

-- A cell of the connected table, as the table editor keeps it.
create function public.survey_cell(r integer, c integer, value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('r', r, 'c', c, 'v',
    case when jsonb_typeof(value) = 'number'
      then jsonb_build_object('v', value, 'm', value #>> '{}', 'ct', jsonb_build_object('fa', 'General', 't', 'n'))
      else jsonb_build_object('v', value #>> '{}', 'm', value #>> '{}', 'ct', jsonb_build_object('fa', 'General', 't', 'g'))
    end);
$$;

-- One answer written as a row of the connected table (or its row changed): the
-- header row has the time, the person and every question; new questions get
-- new columns at the end.
create function public.survey_sheet_put(target_object uuid, target_response uuid)
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
    public.survey_cell(row_at, 1, to_jsonb(coalesce(person, st.sheet_labels ->> 'anonymous', ''))));

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
    if jsonb_typeof(answer) = 'array' then
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

-- What someone opening a survey sees about it: how it takes answers, whether it
-- is closed, whether (and what) they answered; the count only for those who manage it.
create function public.survey_state(target_object uuid)
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
    'sheet', case when manager and st.sheet_id is not null then jsonb_build_object('id', st.sheet_id, 'title', sheet_title, 'name', st.sheet_name, 'full', st.sheet_full) end
  );
end;
$$;

-- How the survey takes answers: its editors. Anonymity can't change once there are answers.
create function public.set_survey_settings(target_object uuid, new_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  st public.survey_settings;
  new_anonymous boolean;
  new_closes timestamptz;
  new_max integer;
begin
  if ws is null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if jsonb_typeof(new_settings) is distinct from 'object' then
    return public.page_error('invalid');
  end if;
  begin
    new_closes := nullif(new_settings ->> 'closes_at', '')::timestamptz;
    new_max := nullif(new_settings ->> 'max_responses', '')::integer;
  exception when others then
    return public.page_error('invalid');
  end;
  if new_max is not null and new_max not between 1 and 10000 then
    return public.page_error('invalid');
  end if;
  select * into st from public.survey_settings where object_id = target_object;
  new_anonymous := coalesce((new_settings ->> 'anonymous')::boolean, st.anonymous, false);
  if new_anonymous is distinct from coalesce(st.anonymous, false)
     and exists (select 1 from public.survey_responses r where r.object_id = target_object) then
    return public.page_error('has_responses');
  end if;
  insert into public.survey_settings as s (object_id, workspace_id, anonymous, once, editable, accepting, closes_at, max_responses, updated_by, updated_at)
  values (target_object, ws, new_anonymous,
          coalesce((new_settings ->> 'once')::boolean, st.once, true),
          coalesce((new_settings ->> 'editable')::boolean, st.editable, false),
          coalesce((new_settings ->> 'accepting')::boolean, st.accepting, true),
          case when new_settings ? 'closes_at' then new_closes else st.closes_at end,
          case when new_settings ? 'max_responses' then new_max else st.max_responses end,
          auth.uid(), now())
  on conflict (object_id) do update
    set anonymous = excluded.anonymous, once = excluded.once, editable = excluded.editable, accepting = excluded.accepting,
        closes_at = excluded.closes_at, max_responses = excluded.max_responses, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- An answer: everyone who can open the survey, while it is open.
create function public.submit_survey_response(target_object uuid, answers jsonb)
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

-- The answers (with who gave them, unless anonymous): those who manage the survey.
create function public.survey_answers(target_object uuid)
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
                                        'name', p.name, 'email', p.email) order by r.created_at)
    from public.survey_responses r left join public.profiles p on p.id = r.user_id
    where r.object_id = target_object), '[]'::jsonb));
end;
$$;

-- Removing one answer (its row in the connected table stays): those who manage the survey.
create function public.delete_survey_response(target_object uuid, target_response uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_read_survey_answers(target_object) then
    return public.page_error('forbidden');
  end if;
  delete from public.survey_responses where id = target_response and object_id = target_object;
  return jsonb_build_object('ok', true, 'deleted', found);
end;
$$;

-- Connecting a table (one the person may edit, in the same workspace): its sheet
-- `tab` gets a header and every answer so far; null disconnects it.
create function public.link_survey_sheet(target_object uuid, target_sheet uuid, tab text, labels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  response record;
begin
  if ws is null or not public.can_read_survey_answers(target_object) then
    return public.page_error('forbidden');
  end if;
  if target_sheet is not null then
    if not exists (select 1 from public.service_objects o where o.id = target_sheet and o.service = 'sheets' and o.workspace_id = ws and o.deleted_at is null)
       or public.role_rank(public.service_object_role(target_sheet)) < public.role_rank('editor') then
      return public.page_error('forbidden');
    end if;
    if char_length(coalesce(btrim(tab), '')) not between 1 and 60 or jsonb_typeof(labels) is distinct from 'object' or pg_column_size(labels) > 2000 then
      return public.page_error('invalid');
    end if;
  end if;
  insert into public.survey_settings as s (object_id, workspace_id, sheet_id, sheet_name, sheet_columns, sheet_labels, sheet_full, updated_by, updated_at)
  values (target_object, ws, target_sheet, case when target_sheet is not null then btrim(tab) end, '{}'::jsonb,
          case when target_sheet is not null then labels else '{}'::jsonb end, false, auth.uid(), now())
  on conflict (object_id) do update
    set sheet_id = excluded.sheet_id, sheet_name = excluded.sheet_name, sheet_columns = '{}'::jsonb, sheet_labels = excluded.sheet_labels,
        sheet_full = false, updated_by = auth.uid(), updated_at = now();
  update public.survey_responses set sheet_row = null where object_id = target_object;
  for response in select r.id from public.survey_responses r where r.object_id = target_object order by r.created_at loop
    perform public.survey_sheet_put(target_object, response.id);
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.check_survey_workspace() from public, anon, authenticated;
revoke execute on function public.can_read_survey_answers(uuid) from public, anon, authenticated;
revoke execute on function public.survey_clean_answers(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.survey_cell(integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.survey_sheet_put(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.survey_state(uuid) from public, anon;
revoke execute on function public.set_survey_settings(uuid, jsonb) from public, anon;
revoke execute on function public.submit_survey_response(uuid, jsonb) from public, anon;
revoke execute on function public.survey_answers(uuid) from public, anon;
revoke execute on function public.delete_survey_response(uuid, uuid) from public, anon;
revoke execute on function public.link_survey_sheet(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.survey_state(uuid) to authenticated;
grant execute on function public.set_survey_settings(uuid, jsonb) to authenticated;
grant execute on function public.submit_survey_response(uuid, jsonb) to authenticated;
grant execute on function public.survey_answers(uuid) to authenticated;
grant execute on function public.delete_survey_response(uuid, uuid) to authenticated;
grant execute on function public.link_survey_sheet(uuid, uuid, text, jsonb) to authenticated;
