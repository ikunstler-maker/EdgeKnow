-- The fish and lure settings: on by default, each person changes only their own.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000020a1', 'quinn@fish.test', now()),
 ('00000000-0000-0000-0000-0000000020b1', 'rosa@fish.test', now());
select 'defaults: ' || show_mascot || ' ' || lure from public.profiles where id = '00000000-0000-0000-0000-0000000020a1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a1';
select 'hide the fish: ' || public.set_my_appearance(false, null)::text;
select 'subdued lure: ' || public.set_my_appearance(null, 'subtle')::text;
select 'bad mode: ' || public.set_my_appearance(null, 'neon')::text;
reset role;
select 'quinn: ' || show_mascot || ' ' || lure from public.profiles where id = '00000000-0000-0000-0000-0000000020a1';
select 'rosa untouched: ' || show_mascot || ' ' || lure from public.profiles where id = '00000000-0000-0000-0000-0000000020b1';
\set ON_ERROR_STOP 0
set role anon;
select public.set_my_appearance(false, 'hidden');
reset role;
\set ON_ERROR_STOP 1
