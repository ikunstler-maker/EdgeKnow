-- Toker, stage 1c: mentions and thread replies in the bell — only to people who see
-- the channel, not when silenced or muted, once per message, hidden once deleted.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000079a1', 'alice@ment.test', now()),
 ('00000000-0000-0000-0000-0000000079b1', 'bob@ment.test', now()),
 ('00000000-0000-0000-0000-0000000079c1', 'carol@ment.test', now()),
 ('00000000-0000-0000-0000-0000000079d1', 'dan@ment.test', now());
\set alice '00000000-0000-0000-0000-0000000079a1'
\set bob '00000000-0000-0000-0000-0000000079b1'
\set carol '00000000-0000-0000-0000-0000000079c1'
\set dan '00000000-0000-0000-0000-0000000079d1'
\set bell '(select coalesce(string_agg((x ->> ''kind'') || '':'' || coalesce(x -> ''chat'' ->> ''excerpt'', ''hidden''), '', '' order by x ->> ''created_at'', x ->> ''kind''), ''nothing'') from jsonb_array_elements(public.my_notifications(:''ws'', 30) -> ''items'') x where x ->> ''kind'' like ''chat_%'')'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Mentions') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'ment.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset

set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'general', '', false, null) ->> 'id' as general \gset
select public.chat_create_channel(:'ws', null, 'secret', '', true, null) ->> 'id' as secret \gset
select public.chat_add_members(:'secret', array[:'carol']::uuid[]) ->> 'ok' as ignored \gset
select public.chat_post_message(:'general', 'Hi carol and dan', null, array[:'carol', :'dan']::uuid[]) ->> 'id' as hi \gset
select public.chat_post_message(:'secret', 'Secret for carol, not dan', null, array[:'carol', :'dan']::uuid[]) ->> 'id' as psst \gset
select public.chat_post_message(:'general', 'Mentioning myself', null, array[:'bob']::uuid[]) ->> 'id' as self \gset
set request.jwt.claim.sub = :'carol';
select 'carol''s bell: ' || :bell;
set request.jwt.claim.sub = :'dan';
select 'dan''s bell: ' || :bell;
select 'dan silences general: ' || (public.chat_set_notify(:'general', 'none') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select public.chat_post_message(:'general', 'Reply to bob', :'hi', array[:'dan']::uuid[]) ->> 'id' as reply \gset
set request.jwt.claim.sub = :'bob';
select 'bob''s bell (a reply to his message): ' || :bell;
select 'bob edits, adding alice: ' || (public.chat_edit_message(:'hi', 'Hi carol, dan and alice', array[:'carol', :'dan', :'alice']::uuid[]) ->> 'ok');
set request.jwt.claim.sub = :'alice';
select 'alice''s bell: ' || :bell;
select 'alice mutes chat mentions: ' || (public.set_notification_prefs(:'ws', array['chat_mention']) ->> 'ok');
set request.jwt.claim.sub = :'dan';
select 'dan''s bell (silenced the channel): ' || :bell;
set request.jwt.claim.sub = :'bob';
select public.chat_post_message(:'general', 'Alice again', null, array[:'alice']::uuid[]) ->> 'id' as again \gset
set request.jwt.claim.sub = :'alice';
select 'alice''s bell after muting: ' || :bell;
set request.jwt.claim.sub = :'bob';
select 'bob deletes the first message: ' || (public.chat_delete_message(:'hi') ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol''s bell after: ' || :bell;
select 'a wrong kind muted: ' || (public.set_notification_prefs(:'ws', array['chat_shout']) ->> 'error');
reset role;
