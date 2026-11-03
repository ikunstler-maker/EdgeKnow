-- Surveys, step О3: a link for anyone. Only EdgeKnow's server (secret key) reaches
-- a survey through it — never the "anon" or "authenticated" roles — and only
-- while it is on; the old link stops working when renewed; limits per visitor and
-- per survey; files in answers must be the survey's own.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000035a1', 'alice@public-surveys.test', now()),
 ('00000000-0000-0000-0000-0000000035b1', 'bob@public-surveys.test', now()),
 ('00000000-0000-0000-0000-0000000035c1', 'carol@other-public.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select public.create_workspace('Public surveys') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'public-surveys.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035c1';
select public.create_workspace('Other public') ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select public.create_service_object(:'ws', 'surveys', 'survey', 'Open poll', '{"sections": [{"id": "s", "questions": [
  {"id": "q", "type": "single", "title": "Pick", "required": true, "options": [{"label": "A"}, {"label": "B"}]},
  {"id": "f", "type": "file", "title": "CV"}]}]}') ->> 'id' as survey \gset
select public.create_service_object(:'ws', 'surveys', 'survey', 'Other poll', '{"sections": []}') ->> 'id' as other \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035b1';
select 'a member who only answers turns the link on: ' || public.set_survey_public(:'survey', true, false)::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select public.set_survey_public(:'survey', true, false) ->> 'token' as token \gset
select 'the owner turns it on: ' || (public.survey_state(:'survey') -> 'public' ->> 'enabled') || ', token ' || char_length(:'token');
select 'a member adds a file: ' || (public.register_survey_file(:'survey', 'cv.pdf', 'application/pdf', 1000) ->> 'ok');
select 'a file of the wrong kind: ' || public.register_survey_file(:'survey', 'x.exe', 'application/x-msdownload', 10)::text;
select 'a file too big: ' || public.register_survey_file(:'survey', 'big.pdf', 'application/pdf', 5000000)::text;
select public.register_survey_file(:'other', 'elsewhere.pdf', 'application/pdf', 10) ->> 'id' as foreign_file \gset
reset role;
select id as file from public.object_files where name = 'cv.pdf' \gset

-- Nobody reaches the link's functions directly, not even signed in.
set role anon;
select 'anon reads the survey: ' || public.public_survey(:'token')::text;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035c1';
select 'a signed-in outsider answers directly: ' || public.submit_public_survey_response(:'token', '{"q": "A"}', repeat('a', 64), null, null)::text;
select 'a signed-in outsider adds a file directly: ' || public.register_public_survey_file(:'token', 'x.pdf', 'application/pdf', 10)::text;
reset role;

-- As EdgeKnow's server.
select 'the server reads it: ' || (public.public_survey(:'token') - 'id' - 'workspace_id' - 'data')::text;
select 'a wrong token: ' || public.public_survey('0123456789abcdef0123456789abcdef')::text;
select 'required still required: ' || public.submit_public_survey_response(:'token', '{"f": []}', repeat('a', 64), null, null)::text;
select 'another survey''s file: ' || public.submit_public_survey_response(:'token', jsonb_build_object('q', 'A', 'f', jsonb_build_array(:'foreign_file')), repeat('a', 64), null, null)::text;
select 'an answer with its file: ' || public.submit_public_survey_response(:'token', jsonb_build_object('q', 'A', 'f', jsonb_build_array(:'file')), repeat('a', 64), 'Dana', 'dana@elsewhere.test')::text;
select 'kept as: ' || public || ' ' || coalesce(user_id::text, 'no account') || ' ' || respondent_name || ' ' || respondent_email from public.survey_responses where object_id = :'survey';
select 'once per signed-in person: ' || public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('b', 64), 'Dana', 'DANA@elsewhere.test')::text;
select 'answers: ' || (public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('a', 64), null, null) ->> 'ok')
       || (public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('a', 64), null, null) ->> 'ok')
       || (public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('a', 64), null, null) ->> 'ok')
       || (public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('a', 64), null, null) ->> 'ok');
select 'the sixth from one visitor in 10 minutes: ' || public.submit_public_survey_response(:'token', '{"q": "B"}', repeat('a', 64), null, null)::text;
select 'another visitor: ' || (public.submit_public_survey_response(:'token', '{"q": "A"}', repeat('c', 64), null, null) ->> 'ok');
select 'hits keep no address: ' || count(*) || ' ' || bool_and(visitor ~ '^[0-9a-f]{64}$') from public.survey_public_hits;
select 'a file through the link: ' || (public.register_public_survey_file(:'token', 'photo.png', 'image/png', 500) ->> 'ok');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select 'the owner reads: ' || (select string_agg(coalesce(r ->> 'name', '—') || ':' || (r ->> 'public'), ' ' order by r ->> 'created_at') from jsonb_array_elements(public.survey_answers(:'survey') -> 'responses') r)
       || ', files ' || (select count(*) from jsonb_object_keys(public.survey_answers(:'survey') -> 'files'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035b1';
select 'a member who only answers sees the survey''s files: ' || count(*) from public.object_files where object_id = :'survey';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select 'a new link: ' || (public.set_survey_public(:'survey', null, true) ->> 'token' <> :'token');
reset role;
select 'the old link: ' || public.public_survey(:'token')::text;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';
select public.survey_state(:'survey') -> 'public' ->> 'token' as token2 \gset
select 'turned off: ' || (public.set_survey_public(:'survey', false, false) ->> 'enabled');
reset role;
select 'the link when off: ' || public.public_survey(:'token2')::text;
update public.object_files set created_at = now() - interval '2 days' where object_id = :'survey';
select 'files never sent go after a day: ' || public.clean_survey_files() || ' removed';
select 'kept (sent with an answer): ' || string_agg(name, ',') from public.object_files where object_id = :'survey';
delete from public.workspaces where name in ('Public surveys', 'Other public');
-- The files' records of the cleanup above are not needed by the later tests.
delete from public.attachment_tombstones where storage_path like :'ws' || '/%';
delete from auth.users where email in ('alice@public-surveys.test', 'bob@public-surveys.test', 'carol@other-public.test');
