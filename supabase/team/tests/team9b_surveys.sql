-- Surveys (steps О1, О2) in a team database: answering, the answers only for
-- those who manage the survey, and the connected table.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_carol 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000c1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1","email":"carol@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'surveys', 'survey', 'Team poll', '{"sections": [{"id": "s", "questions": [{"id": "q", "type": "single", "title": "Pick", "required": true, "options": [{"label": "A"}, {"label": "B"}]}]}]}') ->> 'id' as survey \gset
select public.create_service_object(:'ws', 'sheets', 'sheet', 'Poll table', '{"sheets": [{"name": "Main", "celldata": []}]}') ->> 'id' as sheet \gset
select 'team survey text: ' || search_text || ', open as ' || workspace_role from public.service_objects where id = :'survey';
select 'connect: ' || (public.link_survey_sheet(:'survey', :'sheet', 'Answers', '{"time": "Time", "person": "Who"}') ->> 'ok');
select 'bob answers: ' || public.submit_survey_response(:'survey', '{"q": "B"}')::text;
select 'bob reads: ' || jsonb_array_length(public.survey_answers(:'survey') -> 'responses');
select 'bob''s data export: ' || (public.my_survey_answers(:'ws') -> 0 ->> 'survey') || ' ' || (public.my_survey_answers(:'ws') -> 0 -> 'answers' ->> 'q');
reset role;
select 'the table got a row: ' || count(*) from public.service_objects o, jsonb_array_elements(o.data -> 'sheets') s, jsonb_array_elements(s -> 'celldata') c
where o.id = :'sheet' and s ->> 'name' = 'Answers' and (c ->> 'r')::integer = 1;
set role authenticated;
:as_carol;
select 'carol (not a member): ' || public.survey_state(:'survey')::text || ' ' || public.submit_survey_response(:'survey', '{"q": "A"}')::text || ' ' || public.survey_answers(:'survey')::text || ' ' || public.my_survey_answers(:'ws')::text;
reset role;
