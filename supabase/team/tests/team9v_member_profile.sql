-- Profile card in a team database: job title, departments and teams, birthday set from
-- the profile by the owner; a stranger sees nothing.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set bob '00000000-0000-0000-0000-0000000000b1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

-- Units come from the central copy: Ops (top) > Night shift, with Bob in Night shift.
insert into public.workspace_groups (id, workspace_id, name, parent_id) values
 ('00000000-0000-0000-0000-00000000c9a1', :'ws', 'Ops', null),
 ('00000000-0000-0000-0000-00000000c9a2', :'ws', 'Night shift', '00000000-0000-0000-0000-00000000c9a1');
insert into public.workspace_group_members (group_id, workspace_id, user_id) values ('00000000-0000-0000-0000-00000000c9a2', :'ws', :'bob');

set role authenticated;
:as_bob;
select 'bob sets his title: ' || (public.set_member_job_title(:'ws', :'bob', 'Night lead') ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'owner sets bob''s birthday: ' || (public.set_member_birthday_date(:'ws', :'bob', 6, 1) ->> 'ok');
select 'alice sees: ' || (public.member_card(:'ws', :'bob') - 'avatar_url' - 'name' - 'role')::text;
reset role;
set role authenticated;
:as_zed;
select 'zed sees: ' || (public.member_card(:'ws', :'bob') ->> 'error') || ', sets: ' || (public.set_member_job_title(:'ws', :'bob', 'x') ->> 'error');
reset role;
-- Leave the shared state as it was.
delete from public.workspace_group_members where group_id = '00000000-0000-0000-0000-00000000c9a2';
delete from public.workspace_groups where id = '00000000-0000-0000-0000-00000000c9a2';
delete from public.workspace_groups where id = '00000000-0000-0000-0000-00000000c9a1';
update public.leave_member_settings set job_title = null, birth_month = null, birth_day = null, birth_year = null where workspace_id = :'ws' and user_id = :'bob';
