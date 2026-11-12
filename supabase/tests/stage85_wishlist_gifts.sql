-- Wishlists, step 3: "I'll give this" (one giver, others chip in), seen by colleagues but
-- never by the owner; the owner learns only which wishes are taken; removing a taken wish
-- or the wishlist tells the people taking part (unless they muted it).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000085a1', 'alice@gift.test', now()),
 ('00000000-0000-0000-0000-0000000085b1', 'bob@gift.test', now()),
 ('00000000-0000-0000-0000-0000000085c1', 'carol@gift.test', now()),
 ('00000000-0000-0000-0000-0000000085d1', 'dan@gift.test', now()),
 ('00000000-0000-0000-0000-0000000085e1', 'gwen@client-gift.test', now()),
 ('00000000-0000-0000-0000-0000000085f1', 'eve@other-gift.test', now());
\set alice '00000000-0000-0000-0000-0000000085a1'
\set bob '00000000-0000-0000-0000-0000000085b1'
\set carol '00000000-0000-0000-0000-0000000085c1'
\set dan '00000000-0000-0000-0000-0000000085d1'
\set gwen '00000000-0000-0000-0000-0000000085e1'
\set eve '00000000-0000-0000-0000-0000000085f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Gifts') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'gift.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-gift.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
reset role;
update public.profiles set name = initcap(split_part(email, '@', 1)) where email like '%gift.test';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.set_my_birthday(:'ws', extract(month from d)::int, extract(day from d)::int, null, true) ->> 'ok' as ignored
  from (select (now() at time zone 'UTC')::date + 20 as d) x \gset
select public.create_wishlist(:'ws') ->> 'id' as wl \gset
select public.save_service_object(:'wl', 'Bob''s list', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glass","pattern":null},"items":[{"id":"a","title":"Kettle"},{"id":"b","title":"Book"},{"id":"c","title":"Plant"}]}', 1) ->> 'ok' as ignored \gset
select public.set_wishlist_published(:'wl', true) ->> 'ok' as ignored \gset

-- Giving and chipping in.
set request.jwt.claim.sub = :'carol';
select 'carol gives the kettle: ' || (public.wishlist_gift(:'wl', 'a', 'gives') ->> 'ok') || ', a wish that isn''t there: ' || (public.wishlist_gift(:'wl', 'zz', 'gives') ->> 'error')
  || ', a strange kind: ' || (public.wishlist_gift(:'wl', 'b', 'steals') ->> 'error');
set request.jwt.claim.sub = :'dan';
select 'dan gives it too: ' || (public.wishlist_gift(:'wl', 'a', 'gives') ->> 'error') || ', chips in: ' || (public.wishlist_gift(:'wl', 'a', 'chips_in') ->> 'ok');
select 'dan sees: ' || (public.wishlist_gifts_of(:'wl') -> 'gifts')::text;
set request.jwt.claim.sub = :'gwen';
select 'guest gives: ' || (public.wishlist_gift(:'wl', 'b', 'gives') ->> 'error') || ', sees: ' || (public.wishlist_gifts_of(:'wl') ->> 'error');
set request.jwt.claim.sub = :'eve';
select 'stranger: ' || (public.wishlist_gift(:'wl', 'b', 'gives') ->> 'error') || ', rows: ' || (select count(*) from public.wishlist_gifts);

-- The owner: never who, only which.
set request.jwt.claim.sub = :'bob';
select 'bob gives to himself: ' || (public.wishlist_gift(:'wl', 'b', 'gives') ->> 'error')
  || ', reads who gives: ' || (public.wishlist_gifts_of(:'wl') ->> 'error')
  || ', reads the table: ' || (select count(*) from public.wishlist_gifts)
  || ', which wishes are taken: ' || (public.wishlist_claimed_items(:'wl') -> 'items')::text;
set request.jwt.claim.sub = :'carol';
select 'carol asks which are taken: ' || (public.wishlist_claimed_items(:'wl') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'the workspace owner sees: ' || jsonb_array_length(public.wishlist_gifts_of(:'wl') -> 'gifts');

-- Taking a part back.
set request.jwt.claim.sub = :'carol';
select 'carol takes it back: ' || (public.wishlist_ungift(:'wl', 'a') ->> 'ok');
set request.jwt.claim.sub = :'dan';
select 'now dan gives it: ' || (public.wishlist_gift(:'wl', 'a', 'gives') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol chips in: ' || (public.wishlist_gift(:'wl', 'a', 'chips_in') ->> 'ok') || ', gives the book: ' || (public.wishlist_gift(:'wl', 'b', 'gives') ->> 'ok');

-- Bob removes the kettle: Dan and Carol hear about it; the book stays taken.
set request.jwt.claim.sub = :'bob';
select 'bob removes the kettle: ' || (public.save_service_object(:'wl', 'Bob''s list', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glass","pattern":null},"items":[{"id":"b","title":"Book"},{"id":"c","title":"Plant"}]}', 3) ->> 'ok');
reset role;
select 'notes: ' || string_agg(p.name || ' ' || n.kind || ' ' || (n.detail ->> 'item') || ' (' || (n.detail ->> 'wishlist') || ', by ' || a.name || ')', '; ' order by p.name)
  from public.notifications n join public.profiles p on p.id = n.user_id join public.profiles a on a.id = n.actor_id where n.kind like 'wishlist%';
select 'parts left: ' || string_agg(item_id || ' ' || kind, ', ' order by item_id) from public.wishlist_gifts where wishlist_id = :'wl';
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'in carol''s bell: ' || (select x -> 'wishlist' ->> 'item' from jsonb_array_elements(public.my_notifications(:'ws', 10) -> 'items') x where x ->> 'kind' = 'wishlist_item_removed');

-- Bob deletes the wishlist: Carol hears; Dan muted it and chipped in on the plant.
set request.jwt.claim.sub = :'dan';
select 'dan mutes: ' || (public.set_notification_prefs(:'ws', array['wishlist_deleted']) ->> 'ok') || ', chips in: ' || (public.wishlist_gift(:'wl', 'c', 'chips_in') ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob deletes: ' || (public.delete_wishlist(:'wl') ->> 'ok');
reset role;
select 'deleted notes: ' || string_agg(p.name || ' ' || coalesce(n.detail ->> 'wishlist', '?') || ' item:' || coalesce(n.detail ->> 'item', 'none'), '; ')
  from public.notifications n join public.profiles p on p.id = n.user_id where n.kind = 'wishlist_deleted';
select 'parts left: ' || count(*) from public.wishlist_gifts where wishlist_id = :'wl';

-- Leaving the workspace takes one's parts away.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.create_wishlist(:'ws') ->> 'id' as wl2 \gset
select public.save_service_object(:'wl2', '', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glass","pattern":null},"items":[{"id":"x","title":"Tea"}]}', 1) ->> 'ok' as ignored \gset
select public.set_wishlist_published(:'wl2', true) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.wishlist_gift(:'wl2', 'x', 'gives') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'alice';
select public.remove_member(:'ws', :'carol') ->> 'ok' as ignored \gset
reset role;
select 'carol''s parts after leaving: ' || count(*) from public.wishlist_gifts where user_id = :'carol';
