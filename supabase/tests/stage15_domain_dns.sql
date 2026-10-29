-- Domains proven through DNS: only a proven domain lets people in, a proven
-- domain takes over one claimed the instant way, nobody takes over a proven
-- one, and opening registration ends the instant way.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000015a1', 'mallory@dns.test', now()),
 ('00000000-0000-0000-0000-0000000015b1', 'bob@dns.test', now()),
 ('00000000-0000-0000-0000-0000000015c1', 'carol@owner-dns.test', now()),
 ('00000000-0000-0000-0000-0000000015d1', 'dan@owner-dns.test', now()),
 ('00000000-0000-0000-0000-0000000015e1', 'erin@platform-dns.test', now());
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000015e1';

update public.platform_settings set open_registration = true;
set role authenticated;
-- Mallory is first to claim her company's domain the instant way.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015a1';
select public.create_workspace('Squat') ->> 'id' as squat \gset
select 'instant add: ' || public.add_workspace_domain(:'squat', 'dns.test')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
select 'bob in squat: ' || public.is_workspace_member(:'squat');
-- Carol runs the company's real workspace and asks to prove the domain.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015c1';
select public.create_workspace('Real') ->> 'id' as real \gset
select public.request_workspace_domain(:'real', 'dns.test') as request \gset
select 'request: ' || (:'request'::jsonb - 'value')::text || ', value looks right: ' || ((:'request'::jsonb ->> 'value') ~ '^edgeknow-verify=[0-9a-f]{32}$');
select 'request again keeps the value: ' || ((public.request_workspace_domain(:'real', 'dns.test') ->> 'value') = (:'request'::jsonb ->> 'value'));
select 'public domain: ' || public.request_workspace_domain(:'real', 'gmail.com')::text;
select 'carol sees her request: ' || count(*) from public.workspace_domain_claims;
-- Dan isn't an admin of Real; Mallory isn't in it at all.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015d1';
select 'non-member request: ' || public.request_workspace_domain(:'real', 'owner-dns.test')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015a1';
select 'mallory sees requests: ' || count(*) from public.workspace_domain_claims;
select 'mallory, platform list: ' || coalesce(public.platform_domain_requests()::text, 'null');
select 'mallory, platform confirm: ' || public.platform_confirm_domain(:'real', 'dns.test')::text;
reset role;

-- The server found the record: the domain moves to Real, Bob's domain membership of Squat ends.
select 'confirm: ' || public.confirm_workspace_domain(:'real', 'dns.test', 'dns', '00000000-0000-0000-0000-0000000015c1')::text;
select 'domain now: ' || w.name || ' ' || d.method from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id where d.domain = 'dns.test';
select 'requests left: ' || count(*) from public.workspace_domain_claims where domain = 'dns.test';
select 'squat told: ' || count(*) from public.audit_log where workspace_id = :'squat' and action = 'domain_taken_over';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015b1';
select 'bob in squat now: ' || public.is_workspace_member(:'squat');
select public.join_workspaces() ->> 'ok' as ignored \gset
select 'bob in real: ' || public.is_workspace_member(:'real');
-- A proven domain can't be asked for or taken any more.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015a1';
select 'mallory asks back: ' || public.request_workspace_domain(:'squat', 'dns.test')::text;
reset role;
insert into public.workspace_domain_claims (workspace_id, domain) values (:'squat', 'dns.test');
select 'confirm over a proven one: ' || public.confirm_workspace_domain(:'squat', 'dns.test', 'dns', null)::text;
delete from public.workspace_domain_claims where workspace_id = :'squat';

-- The platform admin confirms by hand.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015c1';
select public.request_workspace_domain(:'real', 'owner-dns.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015e1';
select 'platform list: ' || (select string_agg((r ->> 'workspace') || ' ' || (r ->> 'domain'), ', ') from jsonb_array_elements(public.platform_domain_requests()) r);
select 'platform confirm: ' || public.platform_confirm_domain(:'real', 'owner-dns.test')::text;
reset role;
select 'by hand: ' || method from public.workspace_domains where domain = 'owner-dns.test';

-- Opening registration from the panel ends the instant way.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015e1';
select public.set_open_registration(true) ->> 'ok' as ignored \gset
reset role;
select 'instant way after opening: ' || email_domain_proof from public.platform_settings;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015a1';
select 'mallory switches the email way: ' || public.set_email_domain_proof(true)::text;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015e1';
select public.create_workspace('Platform') ->> 'id' as platform \gset
select 'instant add now: ' || public.add_workspace_domain(:'platform', 'platform-dns.test')::text;
reset role;

\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000015c1';
select public.confirm_workspace_domain(:'real', 'dns.test', 'dns', null);
insert into public.workspace_domain_claims (workspace_id, domain) values (:'real', 'evil.test');
set role anon;
select public.request_workspace_domain(:'real', 'dns.test');
reset role;
\set ON_ERROR_STOP 1

update public.platform_settings set open_registration = false, email_domain_proof = true, require_team_database = false;
