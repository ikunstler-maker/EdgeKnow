-- Wishlists in a team database: Bob's draft is his alone, published Alice sees it; a
-- stranger never does.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse
\set ws '00000000-0000-0000-0000-0000000000f1'
\set as_alice 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000a1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_bob 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000b1''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1","email":"bob@team.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''
\set as_zed 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-00000000009f''; set request.jwt.claims = ''{"iss":"https://wiki.test/oidc","role":"authenticated","sub":"00000000-0000-0000-0000-00000000009f","email":"zed@elsewhere.test","ek_workspace":"00000000-0000-0000-0000-0000000000f1"}'''

set role authenticated;
:as_bob;
select public.set_my_birthday(:'ws', 12, 31, null, true) ->> 'ok' as ignored \gset
select public.create_wishlist(:'ws') ->> 'id' as wl \gset
select 'bob made one: ' || (:'wl' <> '');
reset role;
set role authenticated;
:as_alice;
select 'alice sees the draft: ' || count(*) from public.service_objects where id = :'wl';
reset role;
set role authenticated;
:as_bob;
select 'bob publishes: ' || (public.set_wishlist_published(:'wl', true) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice sees it: ' || count(*) from public.service_objects where id = :'wl';
reset role;
set role authenticated;
:as_zed;
select 'zed sees it: ' || count(*) from public.service_objects where id = :'wl';
reset role;
set role authenticated;
:as_bob;
select 'bob deletes it: ' || (public.delete_wishlist(:'wl') ->> 'ok');
select public.set_my_birthday(:'ws', null, null, null, true) ->> 'ok' as ignored \gset
reset role;
