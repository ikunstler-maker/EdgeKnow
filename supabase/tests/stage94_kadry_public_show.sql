-- KADRY-1: a deck's show through a link. Only the deck's owners turn it on and off and see
-- its key; through the key — the slides only, while the link is on and the deck not in the bin.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000094a1', 'alice@kps.test', now()),
 ('00000000-0000-0000-0000-0000000094b1', 'bob@kps.test', now()),
 ('00000000-0000-0000-0000-0000000094e1', 'eve@other-kps.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094a1';
select public.create_workspace('Public shows') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'kps.test') ->> 'ok' as ignored \gset
select public.create_service_object(:'ws', 'slides', 'deck', 'Launch deck', '{"version": 1, "slides": []}') ->> 'id' as deck \gset
select public.create_service_object(:'ws', 'boards', 'board', 'Not a deck', '{}') ->> 'id' as board \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094e1';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
reset role;
update public.platform_settings set open_registration = false;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094b1';
select 'bob (editor of the workspace) turns it on: ' || (public.set_deck_public_link(:'deck', true) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094e1';
select 'eve (stranger): ' || (public.set_deck_public_link(:'deck', true) ->> 'error');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094a1';
select 'a board is not a deck: ' || (public.set_deck_public_link(:'board', true) ->> 'error');
select public.set_deck_public_link(:'deck', true) ->> 'token' as token \gset
select 'alice (owner) turns it on: ' || (length(:'token') = 32);
select 'alice sees the key: ' || count(*) from public.deck_public_links where object_id = :'deck';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094b1';
select 'bob does not: ' || count(*) from public.deck_public_links;
reset role;
select 'anon may read a show: ' || has_function_privilege('anon', 'public.public_deck(text)', 'execute') || ', signed-in people: ' || has_function_privilege('authenticated', 'public.public_deck(text)', 'execute');
select 'through the key: ' || (public.public_deck(:'token') ->> 'title');
select 'a made-up key: ' || (public.public_deck(repeat('a', 32)) ->> 'error');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094a1';
select 'off: ' || (public.set_deck_public_link(:'deck', false) ->> 'enabled');
reset role;
select 'the key while off: ' || (public.public_deck(:'token') ->> 'error');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000094a1';
select public.set_deck_public_link(:'deck', true, true) ->> 'token' as renewed \gset
reset role;
select 'a new key: ' || (:'renewed' <> :'token') || ', the old one: ' || (public.public_deck(:'token') ->> 'error') || ', the new one: ' || (public.public_deck(:'renewed') ->> 'title');
update public.service_objects set deleted_at = now() where id = :'deck';
select 'in the bin: ' || (public.public_deck(:'renewed') ->> 'error');
