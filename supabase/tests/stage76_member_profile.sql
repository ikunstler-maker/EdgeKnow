-- Profile: the member card (job title, departments, teams, birthday), who changes the
-- job title, the birthday set from a profile by who manages time off (no year), own
-- name and picture that signing in no longer overwrites.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000076a1', 'alice@card.test', now(), '{"full_name": "Alice Google"}'),
 ('00000000-0000-0000-0000-0000000076b1', 'bob@card.test', now(), '{"full_name": "Bob Google", "avatar_url": "https://img.test/bob.png"}'),
 ('00000000-0000-0000-0000-0000000076c1', 'carol@card.test', now(), '{}'),
 ('00000000-0000-0000-0000-0000000076e1', 'gwen@client-card.test', now(), '{}'),
 ('00000000-0000-0000-0000-0000000076f1', 'eve@other-card.test', now(), '{}');
\set alice '00000000-0000-0000-0000-0000000076a1'
\set bob '00000000-0000-0000-0000-0000000076b1'
\set carol '00000000-0000-0000-0000-0000000076c1'
\set gwen '00000000-0000-0000-0000-0000000076e1'
\set eve '00000000-0000-0000-0000-0000000076f1'
\set card 'public.member_card(:''ws'', :''bob'')'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Cards') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'card.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-card.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
-- Sales (top) > Key accounts > North; Bob is in North and in Design (top).
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Sales', null) ->> 'id' as sales \gset
select public.create_workspace_group(:'ws', 'Key accounts', :'sales') ->> 'id' as keyacc \gset
select public.create_workspace_group(:'ws', 'North', :'keyacc') ->> 'id' as north \gset
select public.create_workspace_group(:'ws', 'Design', null) ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'north', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'bob', true) ->> 'ok' as ignored \gset

-- The card.
set request.jwt.claim.sub = :'carol';
select 'carol sees bob: ' || (:card - 'avatar_url')::text;
set request.jwt.claim.sub = :'gwen';
select 'guest sees bob: ' || (:card ->> 'error') || ', herself: ' || (public.member_card(:'ws', :'gwen') ->> 'ok');
set request.jwt.claim.sub = :'eve';
select 'stranger sees bob: ' || (:card ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'not a member: ' || (public.member_card(:'ws', :'eve') ->> 'error');

-- Job title.
set request.jwt.claim.sub = :'bob';
select 'bob sets his: ' || (public.set_member_job_title(:'ws', :'bob', '  Sales   manager ') ->> 'ok')
  || ', too long: ' || (public.set_member_job_title(:'ws', :'bob', repeat('x', 81)) ->> 'error')
  || ', carol''s: ' || (public.set_member_job_title(:'ws', :'carol', 'Boss') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'owner sets carol''s: ' || (public.set_member_job_title(:'ws', :'carol', 'Designer') ->> 'ok');
set request.jwt.claim.sub = :'gwen';
select 'guest sets her own: ' || (public.set_member_job_title(:'ws', :'gwen', 'Consultant') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'titles: ' || (:card ->> 'job_title') || ' / ' || (public.member_card(:'ws', :'carol') ->> 'job_title');
select 'carol can edit: bob''s ' || (:card ->> 'can_edit_title') || ', her own ' || (public.member_card(:'ws', :'carol') ->> 'can_edit_title');
reset role;
select 'direct write: ' || has_table_privilege('authenticated', 'public.leave_member_settings', 'update');
set role authenticated;

-- Birthday from the profile: who manages time off, day and month only.
set request.jwt.claim.sub = :'bob';
select 'bob own: ' || (public.set_my_birthday(:'ws', 3, 14, 1990, true) ->> 'ok');
select 'bob on carol''s profile: ' || (public.set_member_birthday_date(:'ws', :'carol', 1, 2) ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'owner can edit bob''s: ' || (:card ->> 'can_edit_birthday') || ', her own: ' || (public.member_card(:'ws', :'alice') ->> 'can_edit_birthday')
  || ', the guest''s: ' || (public.member_card(:'ws', :'gwen') ->> 'can_edit_birthday');
select 'owner, same day: ' || (public.set_member_birthday_date(:'ws', :'bob', 3, 14) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob''s year stays: ' || (public.my_birthday(:'ws') ->> 'year');
set request.jwt.claim.sub = :'alice';
select 'owner, new day: ' || (public.set_member_birthday_date(:'ws', :'bob', 4, 1) ->> 'ok')
  || ', 30 Feb: ' || (public.set_member_birthday_date(:'ws', :'bob', 2, 30) ->> 'error')
  || ', half: ' || (public.set_member_birthday_date(:'ws', :'bob', 2, null) ->> 'error')
  || ', the guest: ' || (public.set_member_birthday_date(:'ws', :'gwen', 1, 1) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob now: ' || (public.my_birthday(:'ws') - 'workspace_on')::text;
set request.jwt.claim.sub = :'carol';
select 'carol sees on the card: ' || (:card -> 'birthday')::text;
set request.jwt.claim.sub = :'bob';
select 'bob hides it: ' || (public.set_my_birthday(:'ws', 4, 1, null, false) ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol sees: ' || coalesce((:card -> 'birthday')::text, 'nothing');
set request.jwt.claim.sub = :'bob';
select 'bob sees his own: ' || (public.member_card(:'ws', :'bob') -> 'birthday')::text;

-- Removal forgets the job title.
set request.jwt.claim.sub = :'alice';
select public.remove_member(:'ws', :'carol') ->> 'ok' as ignored \gset
reset role;
select 'carol after removal: ' || coalesce((select job_title from public.leave_member_settings where workspace_id = :'ws' and user_id = :'carol'), 'no title');

-- Own name and picture.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob renames: ' || (public.set_my_name('  Robert   B. ') ->> 'ok') || ', too long: ' || (public.set_my_name(repeat('x', 81)) ->> 'error');
select 'bad version: ' || (public.set_my_avatar('../x') ->> 'error') || ', upload: ' || (public.set_my_avatar('k1') ->> 'ok');
reset role;
update auth.users set raw_user_meta_data = '{"full_name": "Bob Again", "avatar_url": "https://img.test/new.png"}' where id = :'bob';
select 'after sign-in: ' || name || ' | ' || replace(avatar_url, :'bob', '<bob>') from public.profiles where id = :'bob';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'back to sign-in: ' || (public.set_my_name('') ->> 'ok') || (public.set_my_avatar(null) ->> 'ok');
reset role;
select 'now: ' || name || ' | ' || avatar_url || ' | ' || name_custom || avatar_custom from public.profiles where id = :'bob';
update auth.users set raw_user_meta_data = '{"full_name": "Bob Third"}' where id = :'bob';
select 'follows sign-in again: ' || name from public.profiles where id = :'bob';
set role anon;
select 'anon: ' || (public.set_my_name('x') ->> 'ok');
reset role;
