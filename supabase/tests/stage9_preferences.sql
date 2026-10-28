-- Preferences: only your own profile, only known values.
\pset format unaligned
\pset tuples_only on

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000009a1', 'alice@prefs.test', now()),
 ('00000000-0000-0000-0000-0000000009b1', 'bob@prefs.test', now());

select 'defaults: ' || theme || ' ' || locale from public.profiles where email = 'alice@prefs.test';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009a1';
select 'dark: ' || (public.set_my_preferences('dark', null) ->> 'ok');
select 'english: ' || (public.set_my_preferences(null, 'en') ->> 'ok');
select 'bad theme: ' || (public.set_my_preferences('pink', null))::text;
select 'bad locale: ' || (public.set_my_preferences(null, 'fr'))::text;
reset role;
select 'alice: ' || theme || ' ' || locale from public.profiles where email = 'alice@prefs.test';
select 'bob untouched: ' || theme || ' ' || locale from public.profiles where email = 'bob@prefs.test';
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000009b1';
update public.profiles set theme = 'dark' where email = 'alice@prefs.test';
reset role;
\set ON_ERROR_STOP 1
set role anon;
select 'anonymous: ' || (public.set_my_preferences('dark', 'en'))::text;
reset role;
