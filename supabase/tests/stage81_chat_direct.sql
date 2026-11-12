-- Toker, stage 2a: conversations of two and groups — only their people see them (not
-- admins, not strangers), one per pair, guests only with people they see; people added
-- later see the earlier history only when the channel or the person adding allows it.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000081a1', 'alice@direct.test', now()),
 ('00000000-0000-0000-0000-0000000081b1', 'bob@direct.test', now()),
 ('00000000-0000-0000-0000-0000000081c1', 'carol@direct.test', now()),
 ('00000000-0000-0000-0000-0000000081d1', 'dan@direct.test', now()),
 ('00000000-0000-0000-0000-0000000081e1', 'gwen@client-direct.test', now()),
 ('00000000-0000-0000-0000-0000000081f1', 'eve@other-direct.test', now());
\set alice '00000000-0000-0000-0000-0000000081a1'
\set bob '00000000-0000-0000-0000-0000000081b1'
\set carol '00000000-0000-0000-0000-0000000081c1'
\set dan '00000000-0000-0000-0000-0000000081d1'
\set gwen '00000000-0000-0000-0000-0000000081e1'
\set eve '00000000-0000-0000-0000-0000000081f1'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Direct') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'direct.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as ignored \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-direct.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Conversations of two.
set request.jwt.claim.sub = :'bob';
select public.chat_open_direct(:'ws', array[:'carol']::uuid[]) ->> 'id' as pair \gset
select 'bob writes to carol: ' || (public.chat_post_message(:'pair', 'Hi carol', null, null) ->> 'ok');
set request.jwt.claim.sub = :'carol';
select 'carol opens hers with bob — the same: ' || ((public.chat_open_direct(:'ws', array[:'bob']::uuid[]) ->> 'id') = :'pair');
select 'carol reads: ' || (select count(*) from public.chat_messages where channel_id = :'pair');
select 'carol''s list names it by bob: ' || (select (x -> 'people' ->> 0) = :'bob' from jsonb_array_elements(public.chat_my_channels(:'ws')) x where x ->> 'id' = :'pair');
set request.jwt.claim.sub = :'alice';
select 'alice (owner) sees it: ' || (select count(*) from public.chat_channels where id = :'pair')
  || ', reads: ' || (select count(*) from public.chat_messages where channel_id = :'pair')
  || ', deletes it: ' || (public.chat_delete_channel(:'pair') ->> 'error');
set request.jwt.claim.sub = :'dan';
select 'dan sees it: ' || (select count(*) from public.chat_channels where id = :'pair') || ', writes: ' || (public.chat_post_message(:'pair', 'Me too', null, null) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'a third person into the pair: ' || (public.chat_add_members(:'pair', array[:'dan']::uuid[]) ->> 'error')
  || ', renaming it: ' || (public.chat_update_channel(:'pair', 'ours', '', null, null) ->> 'error')
  || ', with oneself only: ' || (public.chat_open_direct(:'ws', array[:'bob']::uuid[]) ->> 'error')
  || ', with a stranger: ' || (public.chat_open_direct(:'ws', array[:'eve']::uuid[]) ->> 'error');

-- Guests: only with people they see.
set request.jwt.claim.sub = :'gwen';
select 'the guest writes to alice (owner): ' || ((public.chat_open_direct(:'ws', array[:'alice']::uuid[]) ->> 'ok') is not null)
  || ', to dan (never met): ' || (public.chat_open_direct(:'ws', array[:'dan']::uuid[]) ->> 'error');
set request.jwt.claim.sub = :'dan';
select 'dan writes to the guest: ' || ((public.chat_open_direct(:'ws', array[:'gwen']::uuid[]) ->> 'ok') is not null);

-- A group, with the earlier history hidden from people added later.
set request.jwt.claim.sub = :'bob';
select public.chat_open_direct(:'ws', array[:'carol', :'dan']::uuid[]) ->> 'id' as grp \gset
select 'another group with the same people is new: ' || ((public.chat_open_direct(:'ws', array[:'carol', :'dan']::uuid[]) ->> 'id') <> :'grp');
select public.chat_post_message(:'grp', 'Before alice', null, null) ->> 'id' as early \gset
select public.chat_toggle_reaction(:'early', '👍') ->> 'ok' as ignored \gset
select 'bob hides the earlier history: ' || (public.chat_set_history_visible(:'grp', false) ->> 'ok');
reset role;
update public.chat_messages set created_at = now() - interval '1 minute' where id = :'early';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'bob adds alice: ' || (public.chat_add_members(:'grp', array[:'alice']::uuid[]) ->> 'ok');
select public.chat_post_message(:'grp', 'After alice', null, null) ->> 'id' as late \gset
set request.jwt.claim.sub = :'alice';
select 'alice reads: ' || (select string_agg(body, ', ' order by created_at) from public.chat_messages where channel_id = :'grp')
  || ', reactions: ' || (select count(*) from public.chat_reactions where channel_id = :'grp')
  || ', reacts to the hidden one: ' || (public.chat_toggle_reaction(:'early', '🎉') ->> 'error')
  || ', replies to it: ' || (public.chat_post_message(:'grp', 'Re', :'early', null) ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol (there from the start) reads: ' || (select count(*) from public.chat_messages where channel_id = :'grp');
set request.jwt.claim.sub = :'bob';
select 'bob shows alice the history: ' || (public.chat_set_member_history(:'grp', :'alice', true) ->> 'ok');
set request.jwt.claim.sub = :'alice';
select 'alice now reads: ' || (select count(*) from public.chat_messages where channel_id = :'grp');
set request.jwt.claim.sub = :'bob';
select 'bob adds the guest, history shown for her: ' || (public.chat_add_members(:'grp', array[:'gwen']::uuid[], true) ->> 'ok');
set request.jwt.claim.sub = :'gwen';
select 'the guest reads: ' || (select count(*) from public.chat_messages where channel_id = :'grp');
set request.jwt.claim.sub = :'carol';
select 'carol (not managing) hides history: ' || (public.chat_set_history_visible(:'grp', true) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'up to 8 people: ' || (public.chat_add_members(:'grp', array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]::uuid[]) ->> 'error');
select 'the pair''s history setting: ' || (public.chat_set_history_visible(:'pair', false) ->> 'error');
set request.jwt.claim.sub = :'eve';
select 'a stranger sees conversations: ' || (select count(*) from public.chat_channels where visibility = 'direct');

-- Closed channels have the setting too.
set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'secret', '', true, null) ->> 'id' as secret \gset
select public.chat_post_message(:'secret', 'Old news', null, null) ->> 'id' as old \gset
reset role;
update public.chat_messages set created_at = now() - interval '1 minute' where id = :'old';
set role authenticated;
set request.jwt.claim.sub = :'bob';
select 'the channel shows history by default; dan added without it: ' || (public.chat_add_members(:'secret', array[:'dan']::uuid[], false) ->> 'ok')
  || ', carol with it: ' || (public.chat_add_members(:'secret', array[:'carol']::uuid[]) ->> 'ok');
set request.jwt.claim.sub = :'dan';
select 'dan reads: ' || (select count(*) from public.chat_messages where channel_id = :'secret');
set request.jwt.claim.sub = :'carol';
select 'carol reads: ' || (select count(*) from public.chat_messages where channel_id = :'secret');
reset role;
