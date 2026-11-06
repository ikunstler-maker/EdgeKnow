-- Surveys (steps О1, О2): a survey is open to the workspace for answering only;
-- answers are checked against the form (required questions, choices, the path
-- through sections); "once", "editable" and "anonymous" are kept by the database;
-- only those who edit the survey read the answers; a connected table gets a row
-- for every answer.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000034a1', 'alice@surveys.test', now()),
 ('00000000-0000-0000-0000-0000000034b1', 'bob@surveys.test', now()),
 ('00000000-0000-0000-0000-0000000034d1', 'dan@surveys.test', now()),
 ('00000000-0000-0000-0000-0000000034c1', 'carol@other-surveys.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034a1';
select public.create_workspace('Surveys') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'surveys.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034c1';
select public.create_workspace('Other surveys') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;
update public.profiles set name = 'Dan' where email = 'dan@surveys.test';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034b1';
-- Section 1: a required choice ("No" ends the survey), section 2: a scale and a text.
select public.create_service_object(:'ws', 'surveys', 'survey', 'Lunch', '{
  "description": "Where do we eat",
  "sections": [
    {"id": "s1", "title": "Start", "questions": [
      {"id": "q1", "type": "single", "title": "Coming?", "required": true, "options": [{"label": "Yes"}, {"label": "No", "goTo": "submit"}]},
      {"id": "q2", "type": "multi", "title": "Dishes", "options": [{"label": "Soup"}, {"label": "Salad"}, {"label": "Cake"}]}]},
    {"id": "s2", "title": "Details", "questions": [
      {"id": "q3", "type": "scale", "title": "Hunger", "min": 1, "max": 5, "required": true},
      {"id": "q4", "type": "date", "title": "When"},
      {"id": "q5", "type": "short", "title": "Note"}]}]}') as made \gset
select 'bob makes a survey: ' || (:'made'::jsonb ->> 'ok');
select (:'made'::jsonb ->> 'id') as survey \gset
select 'open to the workspace as: ' || workspace_role from public.service_objects where id = :'survey';
select 'text for search: ' || search_text from public.service_objects where id = :'survey';
select 'a survey of another kind: ' || public.create_service_object(:'ws', 'surveys', 'sheet', 'x', '{}')::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'dan opens it: ' || (public.survey_state(:'survey') ->> 'ok') || ', manager ' || (public.survey_state(:'survey') ->> 'manager')
       || ', count shown ' || coalesce(public.survey_state(:'survey') ->> 'count', 'no');
select 'without the required one: ' || public.submit_survey_response(:'survey', '{"q2": ["Soup"]}')::text;
select 'a choice that is not there: ' || public.submit_survey_response(:'survey', '{"q1": "Maybe"}')::text;
select 'out of the scale: ' || public.submit_survey_response(:'survey', '{"q1": "Yes", "q3": 9}')::text;
select 'a wrong date: ' || public.submit_survey_response(:'survey', '{"q1": "Yes", "q3": 3, "q4": "2026-02-30"}')::text;
select 'section 2 is required after "Yes": ' || public.submit_survey_response(:'survey', '{"q1": "Yes"}')::text;
select '"No" ends it (later answers dropped): ' || public.submit_survey_response(:'survey', '{"q1": "No", "q3": 4, "q9": "x"}')::text;
reset role;
select 'dan''s answer as kept: ' || answers::text || ', named ' || (user_id is not null) from public.survey_responses where object_id = :'survey';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'once: ' || public.submit_survey_response(:'survey', '{"q1": "No"}')::text;
select 'dan reads the answers: ' || public.survey_answers(:'survey')::text;
select 'dan reads them directly: ' || count(*) from public.survey_responses;
select 'dan changes the settings (viewer): ' || public.set_survey_settings(:'survey', '{"editable": true}')::text;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034b1';
select 'bob lets people change their answer: ' || (public.set_survey_settings(:'survey', '{"editable": true}') ->> 'ok');
select 'anonymous after answers: ' || public.set_survey_settings(:'survey', '{"anonymous": true}')::text;
select 'bob reads: ' || (select string_agg((r ->> 'name') || ' ' || (r -> 'answers')::text, '; ') from jsonb_array_elements(public.survey_answers(:'survey') -> 'responses') r);
select 'a table to connect' || coalesce(public.create_service_object(:'ws', 'sheets', 'sheet', 'Lunch answers', '{"sheets": [{"name": "Main", "celldata": []}]}') ->> 'error', '') as ignored \gset
select id as sheet from public.service_objects where title = 'Lunch answers' \gset
select 'connect: ' || (public.link_survey_sheet(:'survey', :'sheet', 'Answers', '{"time": "Time", "person": "Who", "anonymous": "Anonymous"}') ->> 'ok');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'dan changes his answer: ' || public.submit_survey_response(:'survey', '{"q1": "Yes", "q2": ["Cake", "Soup", "Cake"], "q3": 5, "q4": "2026-12-01", "q5": "  vegan  "}')::text;
reset role;
select 'still one answer: ' || count(*) || ', ' || max(answers::text) from public.survey_responses where object_id = :'survey';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'dan sees his own: ' || (public.survey_state(:'survey') -> 'mine')::text;
select 'dan''s data export: ' || jsonb_array_length(public.my_survey_answers(:'ws')) || ' ' || (public.my_survey_answers(:'ws') -> 0 -> 'answers' ->> 'q1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034c1';
select 'a stranger''s export of that workspace: ' || public.my_survey_answers(:'ws')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'dan connects a table: ' || public.link_survey_sheet(:'survey', null, null, null)::text;

reset role;
select 'table cells: ' || string_agg(format('%s%s=%s', chr(65 + (c ->> 'c')::integer), (c ->> 'r')::integer + 1, c -> 'v' ->> 'm'), ' ' order by (c ->> 'r')::integer, (c ->> 'c')::integer)
from public.service_objects o, jsonb_array_elements(o.data -> 'sheets') s, jsonb_array_elements(s -> 'celldata') c
where o.id = :'sheet' and s ->> 'name' = 'Answers' and (c ->> 'c')::integer > 0;
select 'table sheets: ' || string_agg(s ->> 'name', ', ') || ', version ' || max(o.version) from public.service_objects o, jsonb_array_elements(o.data -> 'sheets') s where o.id = :'sheet';

-- An anonymous survey with up to 2 answers, any number per person.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034b1';
select public.create_service_object(:'ws', 'surveys', 'survey', 'Mood', '{"sections": [{"id": "a", "questions": [{"id": "m", "type": "rating", "title": "Mood", "max": 5}]}]}') ->> 'id' as mood \gset
select 'anonymous, many, two at most: ' || (public.set_survey_settings(:'mood', '{"anonymous": true, "once": false, "max_responses": 2}') ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'answers: ' || (public.submit_survey_response(:'mood', '{"m": 4}') ->> 'ok') || ' ' || (public.submit_survey_response(:'mood', '{"m": 2}') ->> 'ok')
       || ' ' || public.submit_survey_response(:'mood', '{"m": 5}')::text;
select 'closed for dan: ' || (public.survey_state(:'mood') ->> 'closed');
reset role;
select 'who is written next to the answers: ' || count(user_id) || ' of ' || count(*) from public.survey_responses where object_id = :'mood';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034b1';
select 'bob sees no names: ' || (select string_agg(coalesce(r ->> 'name', '—') || ' ' || (r -> 'answers' ->> 'm'), ', ') from jsonb_array_elements(public.survey_answers(:'mood') -> 'responses') r);
select 'closed by hand: ' || (public.set_survey_settings(:'mood', '{"accepting": false, "max_responses": null}') ->> 'ok');
select 'accepting: ' || (public.survey_state(:'mood') ->> 'accepting') || ', closed ' || (public.survey_state(:'mood') ->> 'closed');
select 'reopened: ' || (public.set_survey_settings(:'mood', '{"accepting": true}') ->> 'ok');
select 'closed now: ' || (public.survey_state(:'mood') ->> 'closed');
select 'a date in the past: ' || (public.set_survey_settings(:'mood', '{"closes_at": "2020-01-01T00:00:00Z"}') ->> 'ok');
select 'closed now: ' || (public.survey_state(:'mood') ->> 'closed');

-- Outsiders get nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034c1';
select 'outsider: ' || public.survey_state(:'survey')::text || ' ' || public.submit_survey_response(:'survey', '{"q1": "No"}')::text
       || ' ' || public.survey_answers(:'survey')::text || ' ' || public.link_survey_sheet(:'survey', null, null, null)::text;
select 'outsider sees surveys: ' || count(*) from public.service_objects where service = 'surveys';
select 'nobody reads the tables directly: ' || (select count(*) from public.survey_settings) + (select count(*) from public.survey_respondents);
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000034d1';
select 'anonymous answers stay out of dan''s export: ' || jsonb_array_length(public.my_survey_answers(:'ws'));
reset role;
set role anon;
select 'anon answers: ' || public.submit_survey_response(:'survey', '{"q1": "No"}')::text;
reset role;
delete from public.workspaces where name in ('Surveys', 'Other surveys');
delete from auth.users where email in ('alice@surveys.test', 'bob@surveys.test', 'dan@surveys.test', 'carol@other-surveys.test');
