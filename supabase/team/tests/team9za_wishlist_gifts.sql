-- "I'll give this" in a team database: Alice gives Bob's wish, Bob can't see who; Bob
-- removes it and Alice hears; a stranger sees nothing.
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
select public.save_service_object(:'wl', 'List', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glass","pattern":null},"items":[{"id":"a","title":"Kettle"}]}', 1) ->> 'ok' as ignored \gset
select public.set_wishlist_published(:'wl', true) ->> 'ok' as ignored \gset
reset role;
set role authenticated;
:as_alice;
select 'alice gives: ' || (public.wishlist_gift(:'wl', 'a', 'gives') ->> 'ok');
reset role;
set role authenticated;
:as_zed;
select 'zed sees parts: ' || count(*) from public.wishlist_gifts;
reset role;
set role authenticated;
:as_bob;
select 'bob sees parts: ' || count(*) from public.wishlist_gifts;
select 'bob removes the wish: ' || (public.save_service_object(:'wl', 'List', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glass","pattern":null},"items":[]}', 3) ->> 'ok');
reset role;
set role authenticated;
:as_alice;
select 'alice hears: ' || count(*) from public.notifications where kind = 'wishlist_item_removed';
reset role;
set role authenticated;
:as_bob;
select 'bob deletes: ' || (public.delete_wishlist(:'wl') ->> 'ok');
select public.set_my_birthday(:'ws', null, null, null, true) ->> 'ok' as ignored \gset
reset role;
delete from public.notifications where kind like 'wishlist%';
