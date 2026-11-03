-- Surveys, step О3, in a team database: the link for anyone only through the server.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.create_service_object(:'ws', 'surveys', 'survey', 'Team open poll', '{"sections": [{"id": "s", "questions": [{"id": "q", "type": "short", "title": "Name"}]}]}') ->> 'id' as survey \gset
select public.set_survey_public(:'survey', true, false) ->> 'token' as token \gset
select 'bob turns the link on: ' || char_length(:'token');
select 'bob answers through it directly: ' || public.submit_public_survey_response(:'token', '{"q": "x"}', repeat('a', 64), null, null)::text;
reset role;
select 'the server answers through it: ' || public.submit_public_survey_response(:'token', '{"q": "from outside"}', repeat('a', 64), null, null)::text;
select 'kept: ' || answers::text || ' ' || public from public.survey_responses where object_id = :'survey';
