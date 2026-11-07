-- Presentations (step П-1): a deck is a service object like the others; pictures may be registered for it.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000048a1', 'alice@slides.test', now()),
 ('00000000-0000-0000-0000-0000000048b1', 'eve@other-slides.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000048a1';
select public.create_workspace('Slides') ->> 'id' as ws \gset
select public.create_service_object(:'ws', 'slides', 'deck', 'Pitch', '{"slides": [{"id": "s1", "nodes": [{"type": "TEXT", "text": "Quarterly goals"}]}]}') ->> 'id' as deck \gset
select 'deck made: ' || count(*) from public.service_objects where id = :'deck' and service = 'slides' and kind = 'deck';
select 'wrong kind: ' || public.create_service_object(:'ws', 'slides', 'board', 'X', '{}')::text;
select 'picture registered: ' || coalesce(public.register_object_file(:'deck', 'a.png', 'image/png', 100) ->> 'ok', 'null');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000048b1';
select 'outsider sees deck: ' || count(*) from public.service_objects where id = :'deck';
select 'outsider picture: ' || (public.register_object_file(:'deck', 'b.png', 'image/png', 100) ->> 'ok');
reset role;
update public.platform_settings set open_registration = false;
select 'deck text: ' || search_text from public.service_objects where service = 'slides';
