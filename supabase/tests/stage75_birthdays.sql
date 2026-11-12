-- Doba: birthdays. Who sets them, who sees them (never the year, never a guest), the
-- person's and the workspace's switches, 29 February, the bell for the person's unit.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000075a1', 'alice@bday.test', now()),
 ('00000000-0000-0000-0000-0000000075b1', 'bob@bday.test', now()),
 ('00000000-0000-0000-0000-0000000075c1', 'carol@bday.test', now()),
 ('00000000-0000-0000-0000-000000007501', 'hank@bday.test', now()),
 ('00000000-0000-0000-0000-0000000075d1', 'dan@bday.test', now()),
 ('00000000-0000-0000-0000-0000000075e1', 'gwen@client-bday.test', now()),
 ('00000000-0000-0000-0000-0000000075f1', 'eve@other-bday.test', now());
\set alice '00000000-0000-0000-0000-0000000075a1'
\set bob '00000000-0000-0000-0000-0000000075b1'
\set carol '00000000-0000-0000-0000-0000000075c1'
\set hank '00000000-0000-0000-0000-000000007501'
\set dan '00000000-0000-0000-0000-0000000075d1'
\set gwen '00000000-0000-0000-0000-0000000075e1'
\set eve '00000000-0000-0000-0000-0000000075f1'
\set seen '(select coalesce(string_agg((x ->> ''name'') || '' '' || (x ->> ''day''), '', '' order by x ->> ''day'', x ->> ''name''), ''nothing'') from jsonb_array_elements(public.calendar_birthdays(:''ws'', ''2031-01-01'', ''2031-12-31'') || public.calendar_birthdays(:''ws'', ''2032-02-01'', ''2032-03-31'')) x)'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Birthdays') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'bday.test') ->> 'ok' as ignored \gset
reset role;
update public.profiles set name = split_part(email, '@', 1) where email like '%bday.test';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-bday.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
-- Bob and Carol share a unit; Dan is in another one; Hank manages time off.
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Team', null) ->> 'id' as team \gset
select public.create_workspace_group(:'ws', 'Other', null) ->> 'id' as otherteam \gset
select public.set_workspace_group_member(:'ws', :'team', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'team', :'carol', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'otherteam', :'dan', true) ->> 'ok' as ignored \gset
select public.save_workspace_role(:'ws', null, 'HR', '{"manage_leave": true}', null) ->> 'id' as hr \gset
select public.set_member_custom_role(:'ws', :'hank', :'hr') ->> 'ok' as ignored \gset

-- Setting.
set request.jwt.claim.sub = :'bob';
select 'bob, 31 April: ' || (public.set_my_birthday(:'ws', 4, 31, null, true) ->> 'error')
  || ', 29 Feb 1990: ' || (public.set_my_birthday(:'ws', 2, 29, 1990, true) ->> 'error')
  || ', born next century: ' || (public.set_my_birthday(:'ws', 5, 1, 2150, true) ->> 'error')
  || ', 29 Feb 1988: ' || (public.set_my_birthday(:'ws', 2, 29, 1988, true) ->> 'ok');
select 'bob reads his own: ' || public.my_birthday(:'ws')::text;
select 'bob sets carol''s: ' || (public.set_member_birthday(:'ws', :'carol', 5, 2, null) ->> 'error');
set request.jwt.claim.sub = :'hank';
select 'hr sets carol''s (with a year): ' || (public.set_member_birthday(:'ws', :'carol', 6, 15, 1985) ->> 'ok')
  || ', the guest''s: ' || (public.set_member_birthday(:'ws', :'gwen', 6, 15, null) ->> 'error')
  || ', a stranger''s: ' || (public.set_member_birthday(:'ws', :'eve', 6, 15, null) ->> 'error');
select 'hr reads the year of carol: ' || (select birth_year from public.leave_member_settings where user_id = :'carol');
set request.jwt.claim.sub = :'dan';
select 'dan sets his, hidden: ' || (public.set_my_birthday(:'ws', 6, 16, null, false) ->> 'ok');
set request.jwt.claim.sub = :'gwen';
select 'the guest sets hers: ' || (public.set_my_birthday(:'ws', 1, 1, null, true) ->> 'error');

-- Seeing.
set request.jwt.claim.sub = :'alice';
select 'alice sees: ' || :seen;
select 'alice (owner, manages time off) reads the rows: ' || (select count(*) from public.leave_member_settings where birth_month is not null);
select 'a year in what alice gets: ' || (public.calendar_birthdays(:'ws', '2031-01-01', '2031-12-31')::text like '%1985%');
set request.jwt.claim.sub = :'dan';
select 'dan sees (his own hidden one too): ' || :seen;
select 'dan reads the rows: ' || (select count(*) from public.leave_member_settings where birth_month is not null);
set request.jwt.claim.sub = :'gwen';
select 'the guest sees: ' || :seen;
set request.jwt.claim.sub = :'eve';
select 'a stranger sees: ' || :seen;
select 'a stranger reads: ' || (public.my_birthday(:'ws') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'a range of five years: ' || jsonb_array_length(public.calendar_birthdays(:'ws', '2031-01-01', '2036-01-01'));

-- The workspace switch: admins only.
set request.jwt.claim.sub = :'bob';
select 'bob turns birthdays off: ' || (public.set_calendar_birthdays(:'ws', false) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'alice turns them off: ' || (public.set_calendar_birthdays(:'ws', false) ->> 'ok');
select 'alice now sees: ' || :seen;
set request.jwt.claim.sub = :'bob';
select 'bob still sees his own: ' || :seen;
set request.jwt.claim.sub = :'alice';
select 'on again: ' || (public.set_calendar_birthdays(:'ws', true) ->> 'ok');
reset role;

-- The bell: today is Carol's birthday (moved to today for the test).
update public.leave_member_settings set birth_month = extract(month from public.workspace_today(:'ws')), birth_day = extract(day from public.workspace_today(:'ws')), birth_year = null
  where user_id = :'carol';
update public.leave_member_settings set birth_month = extract(month from public.workspace_today(:'ws')), birth_day = extract(day from public.workspace_today(:'ws')), birthday_shown = true
  where user_id = :'dan';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.calendar_remind_me(:'ws') as ignored \gset
select 'bob (carol''s unit) hears about: ' || (select string_agg(x -> 'birthday' ->> 'person', ', ' order by x -> 'birthday' ->> 'person') from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' = 'birthday');
select 'asking again adds: ' || public.calendar_remind_me(:'ws');
set request.jwt.claim.sub = :'alice';
select public.calendar_remind_me(:'ws') as ignored \gset
select 'alice (no shared unit) hears about: ' || coalesce((select string_agg(x -> 'birthday' ->> 'person', ', ') from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' = 'birthday'), 'nobody');
set request.jwt.claim.sub = :'carol';
select public.calendar_remind_me(:'ws') as ignored \gset
select 'carol hears about herself: ' || (select count(*) from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' = 'birthday');
set request.jwt.claim.sub = :'gwen';
select public.calendar_remind_me(:'ws') as ignored \gset
select 'the guest hears: ' || (select count(*) from public.notifications where kind = 'birthday');
set request.jwt.claim.sub = :'bob';
select 'bob mutes birthdays: ' || (public.set_notification_prefs(:'ws', array['birthday']) ->> 'ok');
reset role;

-- Hidden later: the bell no longer names her.
update public.leave_member_settings set birthday_shown = false where user_id = :'carol';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'after carol hides it, bob''s bell names: ' || coalesce((select string_agg(x -> 'birthday' ->> 'person', ', ') from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' = 'birthday'), 'nobody');
-- Clearing, and leaving the workspace.
set request.jwt.claim.sub = :'dan';
select 'dan clears his: ' || (public.set_my_birthday(:'ws', null, null, null, true) ->> 'ok');
select 'dan''s now: ' || coalesce(public.my_birthday(:'ws') ->> 'month', 'none');
set request.jwt.claim.sub = :'alice';
select 'alice removes bob: ' || (public.remove_member(:'ws', :'bob') ->> 'ok');
reset role;
select 'bob''s birthday after leaving: ' || coalesce((select birth_month::text from public.leave_member_settings where user_id = :'bob'), 'none');
