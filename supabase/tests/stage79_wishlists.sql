-- Wishlists: made for one's next birthday (one per birthday), a draft only the owner sees
-- (not even admins), published to colleagues who see the birthday (not guests, not
-- strangers), checked content (http(s) links only), copy, publish, delete.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000079a1', 'alice@wish.test', now()),
 ('00000000-0000-0000-0000-0000000079b1', 'bob@wish.test', now()),
 ('00000000-0000-0000-0000-0000000079c1', 'carol@wish.test', now()),
 ('00000000-0000-0000-0000-0000000079e1', 'gwen@client-wish.test', now()),
 ('00000000-0000-0000-0000-0000000079f1', 'eve@other-wish.test', now());
\set alice '00000000-0000-0000-0000-0000000079a1'
\set bob '00000000-0000-0000-0000-0000000079b1'
\set carol '00000000-0000-0000-0000-0000000079c1'
\set gwen '00000000-0000-0000-0000-0000000079e1'
\set eve '00000000-0000-0000-0000-0000000079f1'
\set seen '(select count(*) from public.service_objects where id = :''wl'')'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Wishes') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'wish.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-wish.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Making one.
set request.jwt.claim.sub = :'carol';
select 'carol, no birthday: ' || (public.create_wishlist(:'ws') ->> 'error');
set request.jwt.claim.sub = :'gwen';
select 'guest: ' || (public.create_wishlist(:'ws') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'the generic way: ' || (public.create_service_object(:'ws', 'wishlists', 'wishlist', 'x', '{}') ->> 'error');
select public.set_my_birthday(:'ws', extract(month from d)::int, extract(day from d)::int, 1990, true) ->> 'ok' as ignored
  from (select (now() at time zone 'UTC')::date + 10 as d) x \gset
select public.create_wishlist(:'ws') ->> 'id' as wl \gset
select 'for the next birthday: ' || ((select data ->> 'birthday' from public.service_objects where id = :'wl') = ((now() at time zone 'UTC')::date + 10)::text)
  || ', a draft: ' || (select data ->> 'published' from public.service_objects where id = :'wl');
select 'again: ' || (public.create_wishlist(:'ws') ->> 'error') || ', the same one: ' || ((public.create_wishlist(:'ws') ->> 'id') = :'wl');

-- A draft: only Bob.
set request.jwt.claim.sub = :'carol';
select 'carol sees the draft: ' || :seen;
set request.jwt.claim.sub = :'alice';
select 'the workspace owner sees the draft: ' || :seen || ', deletes it: ' || (public.delete_wishlist(:'wl') ->> 'error');

-- Content.
set request.jwt.claim.sub = :'bob';
select 'a javascript: link: ' || (public.save_service_object(:'wl', 'My list', '{"birthday":"2000-01-01","published":true,"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glow","pattern":null},"items":[{"id":"a","title":"Book","links":["javascript:alert(1)"]}]}', 1) ->> 'error');
select 'four links: ' || (public.save_service_object(:'wl', 'My list', '{"intro":"","design":{"gradient":"ocean","accent":"#112233","effect":"glow","pattern":null},"items":[{"id":"a","title":"Book","links":["https://a.test","https://b.test","https://c.test","https://d.test"]}]}', 1) ->> 'error');
select 'a strange gradient: ' || (public.save_service_object(:'wl', 'My list', '{"intro":"","design":{"gradient":"url(x)","accent":"#112233","effect":"glow","pattern":null},"items":[]}', 1) ->> 'error');
select 'saved: ' || (public.save_service_object(:'wl', 'My list', '{"birthday":"2000-01-01","published":true,"intro":"Thanks!","design":{"gradient":"ocean","accent":"#112233","effect":"glow","pattern":{"emoji":"🎈","size":40,"density":2,"opacity":0.1,"angle":10}},"items":[{"id":"a","title":"Kettle","note":"white","price":"40 €","links":["https://shop.test/kettle"],"image":null}]}', 1) ->> 'ok');
select 'birthday and draft kept: ' || ((select data ->> 'birthday' from public.service_objects where id = :'wl') <> '2000-01-01')
  || ' ' || (select data ->> 'published' from public.service_objects where id = :'wl')
  || ', found by its wishes: ' || (select search_text like '%Kettle%' from public.service_objects where id = :'wl');

-- Published.
set request.jwt.claim.sub = :'carol';
select 'carol publishes Bob''s: ' || (public.set_wishlist_published(:'wl', true) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob publishes: ' || (public.set_wishlist_published(:'wl', true) ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol sees: ' || :seen || ', changes it: ' || (public.save_service_object(:'wl', 'Mine now', null, 3) ->> 'error')
  || ', adds a picture: ' || (public.register_object_file(:'wl', 'x.png', 'image/png', 10) ->> 'error')
  || ', copies it: ' || (public.copy_wishlist(:'wl') ->> 'error');
set request.jwt.claim.sub = :'alice';
select 'the workspace owner sees: ' || :seen || ', changes it: ' || (public.save_service_object(:'wl', 'Mine now', null, 3) ->> 'error');
set request.jwt.claim.sub = :'gwen';
select 'guest sees: ' || :seen;
set request.jwt.claim.sub = :'eve';
select 'stranger sees: ' || :seen;
set request.jwt.claim.sub = :'bob';
select 'bob adds a picture: ' || (public.register_object_file(:'wl', 'x.png', 'image/png', 10) ->> 'ok');
select 'bob hides his birthday: ' || (public.set_my_birthday(:'ws', extract(month from d)::int, extract(day from d)::int, 1990, false) ->> 'ok')
  from (select (now() at time zone 'UTC')::date + 10 as d) x;
set request.jwt.claim.sub = :'carol';
select 'carol sees then: ' || :seen;
set request.jwt.claim.sub = :'bob';
select public.set_my_birthday(:'ws', extract(month from d)::int, extract(day from d)::int, 1990, true) ->> 'ok' as ignored
  from (select (now() at time zone 'UTC')::date + 10 as d) x \gset

-- Copy: for the next birthday, as a draft.
select 'copy while this year''s exists: ' || (public.copy_wishlist(:'wl') ->> 'error');
reset role;
update public.service_objects set data = data || '{"birthday": "2020-01-01"}' where id = :'wl';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.copy_wishlist(:'wl') ->> 'id' as copy \gset
select 'the copy: ' || (select title || ', ' || (data ->> 'published') || ', ' || jsonb_array_length(data -> 'items') || ' wish, for the next birthday: '
  || ((data ->> 'birthday') = ((now() at time zone 'UTC')::date + 10)::text) from public.service_objects where id = :'copy');

-- Delete.
set request.jwt.claim.sub = :'carol';
select 'carol deletes: ' || (public.delete_wishlist(:'wl') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob deletes: ' || (public.delete_wishlist(:'wl') ->> 'ok');
select 'left: ' || :seen;
reset role;
select 'the picture goes too: ' || count(*) from public.object_files where object_id = :'wl';
