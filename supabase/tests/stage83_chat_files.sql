-- Toker, stage 2b: files in chat — registered by who may write, sent with a message, seen
-- only by who sees the message (one's own unsent ones by oneself), kinds and sizes
-- checked, deleted with the message, counted in the workspace's storage; groups of 50.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000083a1', 'alice@chatfiles.test', now()),
 ('00000000-0000-0000-0000-0000000083b1', 'bob@chatfiles.test', now()),
 ('00000000-0000-0000-0000-0000000083c1', 'carol@chatfiles.test', now()),
 ('00000000-0000-0000-0000-0000000083f1', 'eve@other-chatfiles.test', now());
\set alice '00000000-0000-0000-0000-0000000083a1'
\set bob '00000000-0000-0000-0000-0000000083b1'
\set carol '00000000-0000-0000-0000-0000000083c1'
\set eve '00000000-0000-0000-0000-0000000083f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Files') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'chatfiles.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as ignored \gset

set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'secret', '', true, null) ->> 'id' as secret \gset
select public.register_chat_file(:'secret', 'report.pdf', 'application/pdf', 2000, 'file', null, null, null) ->> 'id' as pdf \gset
select public.register_chat_file(:'secret', 'note.ogg', 'audio/ogg', 3000, 'voice', 12000, null, null) ->> 'id' as voice \gset
select 'a page as a file: ' || (public.register_chat_file(:'secret', 'x.html', 'text/html', 10, 'file', null, null, null) ->> 'error')
  || ', 11 MB: ' || (public.register_chat_file(:'secret', 'big.pdf', 'application/pdf', 11534336, 'file', null, null, null) ->> 'error')
  || ', a voice of 6 minutes: ' || (public.register_chat_file(:'secret', 'v.ogg', 'audio/ogg', 10, 'voice', 360000, null, null) ->> 'error')
  || ', a pdf as an image: ' || (public.register_chat_file(:'secret', 'x.pdf', 'application/pdf', 10, 'image', null, null, null) ->> 'error');
reset role;
-- The server stored the bytes.
update public.chat_files set storage_backend = 'supabase' where id in (:'pdf', :'voice');
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol (not in the channel) registers a file there: ' || (public.register_chat_file(:'secret', 'a.pdf', 'application/pdf', 10, 'file', null, null, null) ->> 'error');
select 'carol sends bob''s file elsewhere: ' || (public.chat_post_message((select public.chat_create_channel(:'ws', null, 'carols', '', false, null) ->> 'id')::uuid, '', null, null, array[:'pdf']::uuid[]) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob sees his unsent files: ' || (select count(*) from public.chat_files);
select 'a file not stored yet can''t be sent: ' || (public.chat_post_message(:'secret', 'x', null, null, array[(public.register_chat_file(:'secret', 'later.pdf', 'application/pdf', 10, 'file', null, null, null) ->> 'id')::uuid]) ->> 'error');
select public.chat_post_message(:'secret', '', null, null, array[:'pdf', :'voice']::uuid[]) ->> 'id' as msg \gset
select 'files only, no text: ' || (select file_count || ' ' || (body = '') from public.chat_messages where id = :'msg');
select 'sent twice: ' || (public.chat_post_message(:'secret', 'again', null, null, array[:'pdf']::uuid[]) ->> 'error');
select public.chat_add_members(:'secret', array[:'carol']::uuid[]) ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select 'carol (added) sees the files: ' || (select string_agg(name || ':' || kind, ', ' order by name) from public.chat_files);
set request.jwt.claim.sub = :'alice';
select 'alice (owner, not in it) sees files: ' || (select count(*) from public.chat_files);
set request.jwt.claim.sub = :'eve';
select 'a stranger sees files: ' || (select count(*) from public.chat_files);
set request.jwt.claim.sub = :'bob';
select 'bob deletes the message: ' || (public.chat_delete_message(:'msg') ->> 'ok');
select 'files left: ' || (select count(*) from public.chat_files where message_id = :'msg');
reset role;
select 'their storage is queued for removal: ' || (select count(*) from public.attachment_tombstones where storage_path like :'ws' || '/chat/%');
select 'unsent and older than a day go: ' || (select count(*) from public.chat_files where message_id is null);
update public.chat_files set created_at = now() - interval '2 days' where message_id is null;
select public.clean_chat_files() || ' removed';

-- Group conversations: up to 50 people.
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'a group of 51: ' || (public.chat_open_direct(:'ws', array(select gen_random_uuid() from generate_series(1, 50))) ->> 'error')
  || ', of 50 (strangers): ' || (public.chat_open_direct(:'ws', array(select gen_random_uuid() from generate_series(1, 49))) ->> 'error');
reset role;

-- The workspace's storage limit counts chat files.
update public.workspaces set storage_limit_mb = 1 where id = :'ws';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select public.register_chat_file(:'secret', 'a.pdf', 'application/pdf', 900000, 'file', null, null, null) ->> 'ok' as ignored \gset
select 'over the limit: ' || (public.register_chat_file(:'secret', 'b.pdf', 'application/pdf', 200000, 'file', null, null, null) ->> 'error');
reset role;
