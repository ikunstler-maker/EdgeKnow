-- Bordy «Дизайн»: a design file is a whiteboard of the kind "design"; its text is searchable.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000049a1', 'alice@design.test', now()),
 ('00000000-0000-0000-0000-0000000049b1', 'eve@other-design.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000049a1';
select public.create_workspace('Design') ->> 'id' as ws \gset
select public.create_service_object(:'ws', 'boards', 'design', 'App', '{"pages": [{"id": "p1", "name": "Screens", "nodes": [{"type": "TEXT", "text": "Sign in"}]}]}') ->> 'id' as design \gset
select 'design made: ' || kind || ' ' || search_text from public.service_objects where id = :'design';
select 'idea board still: ' || (public.create_service_object(:'ws', 'boards', 'board', 'Ideas', '{}') ->> 'ok');
select 'wrong kind: ' || public.create_service_object(:'ws', 'boards', 'deck', 'X', '{}')::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000049b1';
select 'outsider sees: ' || count(*) from public.service_objects where id = :'design';
reset role;
update public.platform_settings set open_registration = false;
