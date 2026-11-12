-- The bell: one caller at a time per person and workspace, so two tabs asking at once
-- can't both send the same birthday note or reminder. The lock is per person.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000078a1', 'alice@bell.test', now()),
 ('00000000-0000-0000-0000-0000000078b1', 'bob@bell.test', now());
\set alice '00000000-0000-0000-0000-0000000078a1'
\set bob '00000000-0000-0000-0000-0000000078b1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Bell') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'bell.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
select public.set_my_birthday(:'ws', extract(month from public_today.d)::int, extract(day from public_today.d)::int, null, true) ->> 'ok' as ignored
  from (select (now() at time zone 'UTC')::date as d) public_today \gset
reset role;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'alice';
select 'alice gets: ' || public.calendar_remind_me(:'ws');
select 'her lock is held to the end of the call''s transaction: ' || count(*)
  from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted;
commit;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'asked again: ' || public.calendar_remind_me(:'ws');
reset role;
select 'birthday notes for alice: ' || count(*) from public.notifications where user_id = :'alice' and kind = 'birthday';
select 'no lock left: ' || count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
