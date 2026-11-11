-- Active sessions: admins see and end a member's devices, people their own;
-- an ended session loses access at once; no IP or browser string comes out.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000063a1', 'olga@sess.test', now()),
 ('00000000-0000-0000-0000-0000000063b1', 'adam@sess.test', now()),
 ('00000000-0000-0000-0000-0000000063c1', 'mira@sess.test', now()),
 ('00000000-0000-0000-0000-0000000063d1', 'out@other.test', now());
insert into auth.sessions (id, user_id, user_agent, ip) values
 ('00000000-0000-0000-0000-00000063a001', '00000000-0000-0000-0000-0000000063a1', 'Mozilla/5.0 (X11; Linux x86_64)', '10.0.0.1'),
 ('00000000-0000-0000-0000-00000063b001', '00000000-0000-0000-0000-0000000063b1', 'Mozilla/5.0 (X11; Linux x86_64)', '10.0.0.2'),
 ('00000000-0000-0000-0000-00000063c001', '00000000-0000-0000-0000-0000000063c1', 'Mozilla/5.0 (Linux; Android 14) Mobile', '10.0.0.3'),
 ('00000000-0000-0000-0000-00000063c002', '00000000-0000-0000-0000-0000000063c1', 'Mozilla/5.0 (Linux; Android 14)', '10.0.0.4'),
 ('00000000-0000-0000-0000-00000063c003', '00000000-0000-0000-0000-0000000063c1', 'Mozilla/5.0 (Windows NT 10.0)', '10.0.0.5'),
 ('00000000-0000-0000-0000-00000063d001', '00000000-0000-0000-0000-0000000063d1', 'Mozilla/5.0 (X11; Linux x86_64)', '10.0.0.6');

update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000063a1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000063a1","session_id":"00000000-0000-0000-0000-00000063a001"}';
select public.create_workspace('Sessions') ->> 'id' as ws \gset
reset role;
insert into public.workspace_members (workspace_id, user_id, role, joined_via, status)
select :'ws', u.id, case when u.email like 'adam%' then 'admin' else 'member' end, 'invite', 'active'
from auth.users u where u.email in ('adam@sess.test', 'mira@sess.test')
on conflict do nothing;
set role authenticated;

-- The owner sees mira's three devices: kinds and times only.
select 'owner sees: ' || jsonb_array_length(public.member_sessions(:'ws', '00000000-0000-0000-0000-0000000063c1') -> 'sessions');
select 'kinds: ' || (select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(public.member_sessions(:'ws', '00000000-0000-0000-0000-0000000063c1') -> 'sessions') x);
select 'no ip or agent: ' || (public.member_sessions(:'ws', '00000000-0000-0000-0000-0000000063c1')::text !~ '(10\.0\.0|Mozilla)');
select 'outsider not listed: ' || (public.member_sessions(:'ws', '00000000-0000-0000-0000-0000000063d1') ->> 'error');

-- Mira (a member) can't look at anyone's devices or end them; she sees her own.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000063c1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000063c1","session_id":"00000000-0000-0000-0000-00000063c003"}';
select 'member looks: ' || (public.member_sessions(:'ws', '00000000-0000-0000-0000-0000000063a1') ->> 'error');
select 'member ends: ' || (public.end_member_sessions(:'ws', '00000000-0000-0000-0000-0000000063a1') ->> 'error');
select 'own devices: ' || jsonb_array_length(public.my_sessions() -> 'sessions');
select 'this one marked: ' || (select count(*) from jsonb_array_elements(public.my_sessions() -> 'sessions') x where (x ->> 'current')::boolean);
select 'ends the tablet: ' || (public.end_my_sessions('00000000-0000-0000-0000-00000063c002') ->> 'ended');
select 'can''t end this one by id: ' || (public.end_my_sessions('00000000-0000-0000-0000-00000063c003') ->> 'ended');
select 'left: ' || jsonb_array_length(public.my_sessions() -> 'sessions');

-- An admin can't end the owner's sessions.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000063b1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000063b1","session_id":"00000000-0000-0000-0000-00000063b001"}';
select 'admin ends owner: ' || (public.end_member_sessions(:'ws', '00000000-0000-0000-0000-0000000063a1') ->> 'error');
-- ...but ends mira's: all of them, logged.
select 'admin ends mira: ' || (public.end_member_sessions(:'ws', '00000000-0000-0000-0000-0000000063c1') ->> 'ended');
reset role;
select 'mira sessions left: ' || count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000063c1';
select 'logged: ' || action || ' ' || (details ->> 'email') from public.audit_log where workspace_id = :'ws' and action = 'sessions_ended';
set role authenticated;

-- Mira's token still carries her ended session: no access, and the proxy can tell.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000063c1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000063c1","session_id":"00000000-0000-0000-0000-00000063c003"}';
select 'ended session member: ' || public.is_workspace_member(:'ws');
select 'ended session alive: ' || public.session_alive();
select 'ended session own list: ' || (public.my_sessions() ->> 'error');
-- A live session works as before.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000063b1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000063b1","session_id":"00000000-0000-0000-0000-00000063b001"}';
select 'live session member: ' || public.is_workspace_member(:'ws') || ' alive: ' || public.session_alive();

-- Not callable directly.
select 'list directly: ' || public.session_list('00000000-0000-0000-0000-0000000063a1')::text;
reset role;
update public.platform_settings set open_registration = false;
