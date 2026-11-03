-- Back to before step О3: the link for anyone and files in answers go; the functions are as they were.
delete from public.object_files f using public.service_objects o where o.id = f.object_id and o.service = 'surveys';
revoke execute on function public.can_read_survey_answers(uuid) from authenticated;
drop function public.clean_survey_files();
drop function public.register_public_survey_file(text, text, text, integer);
drop function public.register_survey_file(uuid, text, text, integer);
drop function public.submit_public_survey_response(text, jsonb, text, text, text);
drop function public.public_survey(text);
drop function public.set_survey_public(uuid, boolean, boolean);
drop policy "Members see the pictures of objects open to them" on public.object_files;
create policy "Members see the pictures of objects open to them"
  on public.object_files for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.service_object_role(object_id) is not null);
alter table public.object_files drop constraint object_files_mime_type_check;
alter table public.object_files add constraint object_files_mime_type_check check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp'));
drop table public.survey_public_hits;
CREATE OR REPLACE FUNCTION public.submit_survey_response(target_object uuid, answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.survey_answers(target_object uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.survey_clean_answers(content jsonb, answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.survey_sheet_put(target_object uuid, target_response uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.survey_state(target_object uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
drop function public.survey_files_ok(uuid, jsonb);
drop index public.survey_responses_email_idx;
alter table public.survey_responses drop column public, drop column respondent_name, drop column respondent_email;
alter table public.survey_settings drop column public_enabled, drop column public_token;
