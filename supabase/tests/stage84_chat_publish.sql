-- Toker, stage 2d: channels where chosen people publish — others only comment in
-- threads; who manages sets the policy and the publishers; voice files keep levels.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000084a1', 'alice@publish.test', now()),
 ('00000000-0000-0000-0000-0000000084b1', 'bob@publish.test', now()),
 ('00000000-0000-0000-0000-0000000084c1', 'carol@publish.test', now()),
 ('00000000-0000-0000-0000-0000000084d1', 'dan@publish.test', now());
\set alice '00000000-0000-0000-0000-0000000084a1'
\set bob '00000000-0000-0000-0000-0000000084b1'
\set carol '00000000-0000-0000-0000-0000000084c1'
\set dan '00000000-0000-0000-0000-0000000084d1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Publish') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'publish.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Bob's announcements channel: only chosen people publish.
set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'news', '', false, null) ->> 'id' as news \gset
set request.jwt.claim.sub = :'carol';
select 'carol sets the policy (not managing): ' || (public.chat_set_post_policy(:'news', 'chosen') ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob sets it: ' || (public.chat_set_post_policy(:'news', 'chosen') ->> 'ok') || ', a wrong one: ' || (public.chat_set_post_policy(:'news', 'loud') ->> 'error');
select public.chat_post_message(:'news', 'Release on Friday', null, null) ->> 'id' as post \gset
select 'bob (owner) published: ' || (:'post' is not null);
set request.jwt.claim.sub = :'carol';
select 'carol publishes: ' || (public.chat_post_message(:'news', 'Me too', null, null) ->> 'error')
  || ', comments: ' || (public.chat_post_message(:'news', 'Great', :'post', null) ->> 'ok')
  || ', reacts: ' || (public.chat_toggle_reaction(:'post', '🎉') ->> 'ok');
select 'carol''s list says: ' || (select (x ->> 'post_policy') || ' can_publish=' || (x ->> 'can_publish') from jsonb_array_elements(public.chat_my_channels(:'ws')) x where x ->> 'id' = :'news');
set request.jwt.claim.sub = :'bob';
select 'bob marks dan as publishing: ' || (public.chat_set_member_can_post(:'news', :'dan', true) ->> 'ok');
set request.jwt.claim.sub = :'dan';
select 'dan publishes: ' || (public.chat_post_message(:'news', 'From dan', null, null) ->> 'ok');
set request.jwt.claim.sub = :'alice';
select 'alice (workspace owner) publishes: ' || (public.chat_post_message(:'news', 'From the owner', null, null) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'back to everyone: ' || (public.chat_set_post_policy(:'news', 'everyone') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol publishes now: ' || (public.chat_post_message(:'news', 'Now me', null, null) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select public.chat_open_direct(:'ws', array[:'carol']::uuid[]) ->> 'id' as pair \gset
select 'a conversation can''t be made a publishing channel: ' || (public.chat_set_post_policy(:'pair', 'chosen') ->> 'error');

-- Voice levels.
select 'voice with levels: ' || (public.register_chat_file(:'news', 'v.ogg', 'audio/ogg', 100, 'voice', 5000, null, null, array[1, 2, 5, 3]::smallint[]) ->> 'ok')
  || ', a level of 7: ' || (public.register_chat_file(:'news', 'v.ogg', 'audio/ogg', 100, 'voice', 5000, null, null, array[7]::smallint[]) ->> 'error')
  || ', levels on a pdf: ' || (public.register_chat_file(:'news', 'a.pdf', 'application/pdf', 100, 'file', null, null, null, array[1]::smallint[]) ->> 'error');
select 'kept: ' || (select waveform::text from public.chat_files where name = 'v.ogg');
reset role;
