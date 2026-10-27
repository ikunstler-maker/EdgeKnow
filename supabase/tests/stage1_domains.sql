-- Stage 1 security checks for domains, profiles and the admin audit log.
-- Output is compared with stage1_domains.expected by scripts/test-db.sh.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- hook
select 'hook iyo.gg allowed: ' || (public.hook_before_user_created('{"user":{"email":"A@IYO.GG"}}') = '{}'::jsonb);
select 'hook gmail rejected: ' || (public.hook_before_user_created('{"user":{"email":"x@gmail.com"}}') ? 'error');
select 'hook subdomain rejected: ' || (public.hook_before_user_created('{"user":{"email":"x@sub.iyo.gg"}}') ? 'error');
select 'hook empty rejected: ' || (public.hook_before_user_created('{"user":{}}') ? 'error');
-- users
insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','admin@iyo.gg',now(),'{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-000000000002','user@iyo.gg',now(),'{}'),
 ('00000000-0000-0000-0000-000000000003','unverified@iyo.gg',null,'{}'),
 ('00000000-0000-0000-0000-000000000004','ext@other.com',now(),'{}');
select 'profiles created: ' || count(*) from public.profiles;
update public.profiles set is_admin = true where email = 'admin@iyo.gg';

-- anon
set role anon;
select 'anon hint: ' || coalesce(public.login_domain_hint(),'NULL');
reset role;
\set ON_ERROR_STOP 0
set role anon;
select count(*) from public.profiles;
select public.admin_add_domain('evil.com');
select public.is_allowed_user();
reset role;
\set ON_ERROR_STOP 1

-- plain user
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select 'user allowed: ' || public.is_allowed_user() || ', admin: ' || public.is_admin();
select 'user sees profiles: ' || count(*) from public.profiles;
select 'user sees domains: ' || count(*) from public.allowed_domains;
select 'user add domain: ' || (public.admin_add_domain('evil.com'))::text;
select 'user sees log: ' || count(*) from public.admin_audit_log;
reset role;
\set ON_ERROR_STOP 0
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
insert into public.allowed_domains(domain) values ('evil.com');
update public.profiles set is_admin = true;
select public.log_admin_action('x','{}');
reset role;
\set ON_ERROR_STOP 1
select 'denied attempt logged: ' || count(*) from public.admin_audit_log where action='access_denied';

-- unverified and external
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select 'unverified allowed: ' || public.is_allowed_user() || ' sees profiles: ' || (select count(*) from public.profiles);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'other.com allowed: ' || public.is_allowed_user();
reset role;

-- admin
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'admin: ' || public.is_admin() || ' sees domains: ' || (select count(*) from public.allowed_domains);
select 'add bad: ' || (public.admin_add_domain('not a domain'))::text;
select 'add other.com: ' || (public.admin_add_domain(' Other.COM '))::text;
select 'add dup: ' || (public.admin_add_domain('other.com'))::text;
select 'hint with 2 domains: ' || coalesce(public.login_domain_hint(),'NULL');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'other.com allowed now: ' || public.is_allowed_user();
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'disable iyo.gg (last admin): ' || (public.admin_set_domain_active('iyo.gg', false))::text;
select 'remove iyo.gg (last admin): ' || (public.admin_remove_domain('iyo.gg'))::text;
select 'disable other.com: ' || (public.admin_set_domain_active('other.com', false))::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select 'other.com allowed after disable: ' || public.is_allowed_user();
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select 'remove other.com: ' || (public.admin_remove_domain('other.com'))::text;
select 'remove missing: ' || (public.admin_remove_domain('nope.com'))::text;
select 'log: ' || string_agg(action, ',' order by id) from public.admin_audit_log;
reset role;
-- hook function not callable by clients
\set ON_ERROR_STOP 0
set role authenticated;
select public.hook_before_user_created('{}');
