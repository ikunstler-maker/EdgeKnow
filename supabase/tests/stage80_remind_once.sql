-- Doba: reminders in the bell once — calls of calendar_remind_me run one after another
-- (a lock per person and workspace), and muting event reminders keeps birthdays.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000080a1', 'alice@remind.test', now()),
 ('00000000-0000-0000-0000-0000000080b1', 'bob@remind.test', now());
\set alice '00000000-0000-0000-0000-0000000080a1'
\set bob '00000000-0000-0000-0000-0000000080b1'
\set heard '(select count(*) from public.notifications where user_id = :''alice'' and kind = ''birthday'')'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Remind') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'remind.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
select public.set_my_birthday(:'ws', 1, 1, null, true) ->> 'ok' as ignored \gset
reset role;
-- Bob's birthday is today (both are in no unit: everyone hears).
update public.leave_member_settings set birth_month = extract(month from public.workspace_today(:'ws')), birth_day = extract(day from public.workspace_today(:'ws'))
  where user_id = :'bob';
select 'the lock is taken first: ' || (pg_get_functiondef('public.calendar_remind_me(uuid)'::regprocedure) like '%pg_advisory_xact_lock%');
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'first call adds: ' || public.calendar_remind_me(:'ws');
select 'the second: ' || public.calendar_remind_me(:'ws');
select 'in the bell: ' || :heard;
select 'alice mutes event reminders: ' || (public.set_notification_prefs(:'ws', array['event_reminder']) ->> 'ok');
reset role;
delete from public.notifications where user_id = :'alice';
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'with event reminders muted, the birthday still comes: ' || public.calendar_remind_me(:'ws');
select 'in the bell: ' || :heard;
select 'muting birthdays too: ' || (public.set_notification_prefs(:'ws', array['event_reminder', 'birthday']) ->> 'ok');
reset role;
delete from public.notifications where user_id = :'alice';
set role authenticated;
set request.jwt.claim.sub = :'alice';
select 'with both muted: ' || public.calendar_remind_me(:'ws');
reset role;
