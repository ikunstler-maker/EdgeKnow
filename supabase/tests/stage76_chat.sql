-- Toker, stage 1a: who sees which channel (open, closed, unit, restricted category,
-- guests, admins), the roles' rights to create channels, writing only through the
-- functions, mentions, threads, reactions, read marks, realtime signals and topics.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000076a1', 'alice@chat.test', now()),
 ('00000000-0000-0000-0000-0000000076b1', 'bob@chat.test', now()),
 ('00000000-0000-0000-0000-0000000076c1', 'carol@chat.test', now()),
 ('00000000-0000-0000-0000-0000000076d1', 'dan@chat.test', now()),
 ('00000000-0000-0000-0000-000000007601', 'hank@chat.test', now()),
 ('00000000-0000-0000-0000-0000000076e1', 'gwen@client-chat.test', now()),
 ('00000000-0000-0000-0000-0000000076f1', 'eve@other-chat.test', now());
\set alice '00000000-0000-0000-0000-0000000076a1'
\set bob '00000000-0000-0000-0000-0000000076b1'
\set carol '00000000-0000-0000-0000-0000000076c1'
\set dan '00000000-0000-0000-0000-0000000076d1'
\set hank '00000000-0000-0000-0000-000000007601'
\set gwen '00000000-0000-0000-0000-0000000076e1'
\set eve '00000000-0000-0000-0000-0000000076f1'
\set seen '(select coalesce(string_agg(name, '', '' order by name), ''nothing'') from public.chat_channels)'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Chat') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'chat.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dan';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'hank';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as other \gset
select public.create_workspace_group(:'other', 'Far', null) ->> 'id' as far \gset
set request.jwt.claim.sub = :'alice';
select public.invite_member(:'ws', 'gwen@client-chat.test', 'guest', now() + interval '30 days') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'gwen';
select public.join_workspaces() ->> 'ok' as ignored \gset
-- Units: Sales with EU under it. Bob is in EU, Carol leads Sales, Dan is in no unit.
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Sales', null) ->> 'id' as sales \gset
select public.create_workspace_group(:'ws', 'EU', :'sales') ->> 'id' as eu \gset
select public.set_workspace_group_member(:'ws', :'eu', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'sales', :'carol', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'sales', :'carol', true) ->> 'ok' as ignored \gset
-- Hank's role may not create open channels.
select public.save_workspace_role(:'ws', null, 'Quiet', '{"create_open_channels": false}', null) ->> 'id' as quiet \gset
select public.set_member_custom_role(:'ws', :'hank', :'quiet') ->> 'ok' as ignored \gset

-- Creating channels.
set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'general', 'Everything', false, null) ->> 'id' as general \gset
select public.chat_create_channel(:'ws', null, 'secret', '', true, null) ->> 'id' as secret \gset
select 'bob, the same name again: ' || (public.chat_create_channel(:'ws', null, ' General ', '', false, null) ->> 'error')
  || ', an open channel of a unit: ' || (public.chat_create_channel(:'ws', null, 'x', '', false, :'eu') ->> 'error')
  || ', a unit of another workspace: ' || (public.chat_create_channel(:'ws', null, 'x', '', true, :'far') ->> 'error')
  || ', an empty name: ' || (public.chat_create_channel(:'ws', null, '  ', '', false, null) ->> 'error');
set request.jwt.claim.sub = :'dan';
select public.chat_create_channel(:'ws', null, 'eu-team', '', true, :'eu') ->> 'id' as euch \gset
set request.jwt.claim.sub = :'hank';
select 'hank (no right), open: ' || (public.chat_create_channel(:'ws', null, 'hank-open', '', false, null) ->> 'error')
  || ', closed: ' || (public.chat_create_channel(:'ws', null, 'hank-closed', '', true, null) ->> 'ok');
set request.jwt.claim.sub = :'gwen';
select 'the guest creates: ' || (public.chat_create_channel(:'ws', null, 'gwen', '', false, null) ->> 'error');
set request.jwt.claim.sub = :'eve';
select 'a stranger creates: ' || (public.chat_create_channel(:'ws', null, 'eve', '', false, null) ->> 'error');

-- A restricted category for the Sales unit, with an open channel inside.
set request.jwt.claim.sub = :'bob';
select 'bob makes a category: ' || (public.chat_save_category(:'ws', null, 'Leads', true) ->> 'error');
set request.jwt.claim.sub = :'alice';
select public.chat_save_category(:'ws', null, 'Leads', true) ->> 'id' as leads \gset
select public.chat_save_category(:'ws', null, 'Projects', false) ->> 'id' as projects \gset
select public.chat_save_category(:'ws', null, 'Board', true) ->> 'id' as board \gset
select 'access of a unit: ' || (public.chat_set_category_access(:'ws', :'leads', array[:'sales']::uuid[], null) ->> 'ok')
  || ', of a stranger: ' || (public.chat_set_category_access(:'ws', :'leads', null, array[:'eve']::uuid[]) ->> 'error');
select public.chat_create_channel(:'ws', :'leads', 'leads-room', '', false, null) ->> 'id' as leadsroom \gset
set request.jwt.claim.sub = :'dan';
select 'dan creates in the restricted category: ' || (public.chat_create_channel(:'ws', :'leads', 'dan-lead', '', false, null) ->> 'error')
  || ', in an open one: ' || (public.chat_create_channel(:'ws', :'projects', 'dan-proj', '', false, null) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob adds carol to secret: ' || (public.chat_add_members(:'secret', array[:'carol']::uuid[]) ->> 'ok');
select 'bob adds the guest to general: ' || (public.chat_add_members(:'general', array[:'gwen']::uuid[]) ->> 'ok');
select 'bob adds dan to leads-room: ' || (public.chat_add_members(:'leadsroom', array[:'dan']::uuid[]) ->> 'error');
set request.jwt.claim.sub = :'carol';
select 'carol (in secret, not its owner) adds the guest there: ' || (public.chat_add_members(:'secret', array[:'gwen']::uuid[]) ->> 'error');

-- Seeing.
set request.jwt.claim.sub = :'alice';
select 'alice (owner) sees: ' || :seen;
set request.jwt.claim.sub = :'bob';
select 'bob (EU) sees: ' || :seen;
set request.jwt.claim.sub = :'carol';
select 'carol (leads Sales) sees: ' || :seen;
set request.jwt.claim.sub = :'dan';
select 'dan (no unit) sees: ' || :seen;
select 'dan sees categories: ' || (select string_agg(name, ', ' order by name) from public.chat_categories);
select 'dan reads category access: ' || (select count(*) from public.chat_category_access);
set request.jwt.claim.sub = :'gwen';
select 'the guest sees: ' || :seen;
select 'the guest sees categories: ' || (select count(*) from public.chat_categories);
set request.jwt.claim.sub = :'eve';
select 'a stranger sees: ' || :seen;
set request.jwt.claim.sub = :'alice';
select 'alice reads category access: ' || (select count(*) from public.chat_category_access);

-- Messages.
set request.jwt.claim.sub = :'bob';
select public.chat_post_message(:'general', '  Hello all  ', null, array[:'carol', :'carol', :'eve']::uuid[]) ->> 'id' as hello \gset
select public.chat_post_message(:'secret', 'Just us', null, array[:'carol', :'dan']::uuid[]) ->> 'id' as justus \gset
select 'mentions kept in general: ' || (select mentions::text = array[:'carol']::uuid[]::text from public.chat_messages where id = :'hello')
  || ', in secret: ' || (select mentions::text = array[:'carol']::uuid[]::text from public.chat_messages where id = :'justus');
select 'the body is trimmed: ' || (select body from public.chat_messages where id = :'hello');
set request.jwt.claim.sub = :'carol';
select public.chat_post_message(:'general', 'Reply one', :'hello', null) ->> 'id' as reply \gset
select 'a reply to a reply: ' || (public.chat_post_message(:'general', 'Deeper', :'reply', null) ->> 'error')
  || ', a thread from another channel: ' || (public.chat_post_message(:'secret', 'Wrong', :'hello', null) ->> 'error');
select 'thread of hello: ' || (select reply_count || ' ' || (last_reply_at is not null) from public.chat_messages where id = :'hello');
set request.jwt.claim.sub = :'dan';
select 'dan writes to secret: ' || (public.chat_post_message(:'secret', 'Let me in', null, null) ->> 'error');
select 'dan reads secret: ' || (select count(*) from public.chat_messages where channel_id = :'secret');
select 'dan edits bob''s message: ' || (public.chat_edit_message(:'hello', 'Mine now', null) ->> 'error')
  || ', deletes it: ' || (public.chat_delete_message(:'hello') ->> 'error');
set request.jwt.claim.sub = :'gwen';
select 'the guest writes to general: ' || (public.chat_post_message(:'general', 'Hi from outside', null, null) ->> 'ok');
select 'the guest reads general: ' || (select count(*) from public.chat_messages where channel_id = :'general');
set request.jwt.claim.sub = :'eve';
select 'a stranger writes: ' || (public.chat_post_message(:'general', 'Hi', null, null) ->> 'error');
select 'a stranger reads: ' || (select count(*) from public.chat_messages);

-- Direct writes are closed.
set request.jwt.claim.sub = :'bob';
insert into public.chat_messages (workspace_id, channel_id, author_id, body) values (:'ws', :'general', :'bob', 'direct');
update public.chat_messages set body = 'changed' where id = :'hello';
delete from public.chat_reactions;
insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited) values (:'secret', :'ws', :'dan', true);
select last_read_at from public.chat_channel_members limit 1;
select 'columns bob reads about others: ' || (select count(*) from (select user_id, role, invited from public.chat_channel_members where channel_id = :'secret') x);

-- Editing, deleting, pinning, reactions.
select 'bob edits his: ' || (public.chat_edit_message(:'hello', 'Hello everyone', array[:'dan']::uuid[]) ->> 'ok');
select 'edited: ' || (select body || ' ' || (edited_at is not null) || ' ' || (mentions::text = array[:'dan']::uuid[]::text) from public.chat_messages where id = :'hello');
select 'bob pins it: ' || (public.chat_pin_message(:'hello', true) ->> 'ok');
select 'reaction: ' || (public.chat_toggle_reaction(:'hello', '👍') ->> 'on')
  || ', a word: ' || (public.chat_toggle_reaction(:'hello', 'ok') ->> 'error')
  || ', with a joiner: ' || (public.chat_toggle_reaction(:'hello', '👩‍💻') ->> 'on')
  || ', again (taken back): ' || (public.chat_toggle_reaction(:'hello', '👍') ->> 'on');
set request.jwt.claim.sub = :'carol';
select 'carol reacts: ' || (public.chat_toggle_reaction(:'hello', '🎉') ->> 'on');
set request.jwt.claim.sub = :'dan';
select 'dan reacts in secret: ' || (public.chat_toggle_reaction(:'justus', '🎉') ->> 'error');
select 'dan sees reactions: ' || (select count(*) from public.chat_reactions);
set request.jwt.claim.sub = :'carol';
select 'carol deletes her reply: ' || (public.chat_delete_message(:'reply') ->> 'ok');
select 'thread after: ' || (select reply_count from public.chat_messages where id = :'hello');
select 'the reply is a blank stub: ' || (select (body = '') || ' ' || (deleted_at is not null) from public.chat_messages where id = :'reply');
set request.jwt.claim.sub = :'bob';
select 'bob (owner of general) deletes the guest''s message: ' || (public.chat_delete_message((select id from public.chat_messages where body = 'Hi from outside')) ->> 'ok');

-- Read marks and the list.
set request.jwt.claim.sub = :'carol';
select 'carol''s list: ' || (select string_agg(x ->> 'name' || ' joined=' || (x ->> 'joined') || ' unread=' || (x ->> 'unread') || ' mentioned=' || (x ->> 'mentioned'), '; ' order by x ->> 'name')
  from jsonb_array_elements(public.chat_my_channels(:'ws')) x);
select 'carol joins general: ' || (public.chat_join_channel(:'general') ->> 'ok');
select 'carol marks secret read: ' || (public.chat_mark_read(:'secret', null) ->> 'ok');
select 'carol mutes general: ' || (public.chat_set_notify(:'general', 'mentions') ->> 'ok') || ', a wrong level: ' || (public.chat_set_notify(:'general', 'loud') ->> 'error');
select 'carol''s list after: ' || (select string_agg(x ->> 'name' || ' unread=' || (x ->> 'unread') || ' notify=' || (x ->> 'notify'), '; ' order by x ->> 'name')
  from jsonb_array_elements(public.chat_my_channels(:'ws')) x where (x ->> 'joined')::boolean);
set request.jwt.claim.sub = :'eve';
select 'a stranger''s list: ' || public.chat_my_channels(:'ws')::text;

-- Managing.
set request.jwt.claim.sub = :'carol';
select 'carol renames secret: ' || (public.chat_update_channel(:'secret', 'mine', '', null, null) ->> 'error');
set request.jwt.claim.sub = :'bob';
select 'bob renames secret: ' || (public.chat_update_channel(:'secret', 'secret-2', 'Quiet', null, null) ->> 'ok')
  || ', to a taken name: ' || (public.chat_update_channel(:'secret', 'GENERAL', '', null, null) ->> 'error')
  || ', into the restricted category: ' || (public.chat_update_channel(:'secret', 'secret-2', '', :'board', null) ->> 'error');
select 'bob makes carol an owner: ' || (public.chat_set_member_role(:'secret', :'carol', 'owner') ->> 'ok');
select 'bob leaves secret: ' || (public.chat_leave_channel(:'secret') ->> 'ok');
select 'bob sees secret after leaving: ' || (select count(*) from public.chat_channels where id = :'secret');
set request.jwt.claim.sub = :'carol';
select 'carol, the last owner, steps down: ' || (public.chat_set_member_role(:'secret', :'carol', 'member') ->> 'error');
select 'carol archives secret: ' || (public.chat_archive_channel(:'secret', true) ->> 'ok')
  || ', writes there: ' || (public.chat_post_message(:'secret', 'Late', null, null) ->> 'error')
  || ', still reads: ' || (select count(*) from public.chat_messages where channel_id = :'secret');
set request.jwt.claim.sub = :'alice';
select 'alice (admin, not in it) deletes secret: ' || (public.chat_delete_channel(:'secret') ->> 'error');
select 'alice deletes the category with a channel: ' || (public.chat_delete_category(:'ws', :'leads') ->> 'error')
  || ', an empty one: ' || (public.chat_delete_category(:'ws', :'board') ->> 'ok');
select 'alice (admin) deletes a message in general: ' || (public.chat_delete_message(:'hello') ->> 'ok');

-- Realtime: signals carry ids only; topics follow who sees the channel.
reset role;
select 'signals of general: ' || (select count(*) from realtime.messages where topic = 'chat:' || :'general')
  || ', any with text: ' || (select count(*) from realtime.messages where payload::text like '%Hello%' or payload::text like '%Just us%');
set role authenticated;
set request.jwt.claim.sub = :'carol';
select set_config('realtime.topic', 'chat:' || :'secret', false) as ignored \gset
select 'carol joins the topic of secret: ' || (select count(*) > 0 from realtime.messages);
select set_config('realtime.topic', 'chat-user:' || :'carol', false) as ignored \gset
select 'carol joins her own topic: ' || (select count(*) > 0 from realtime.messages);
select set_config('realtime.topic', 'chat-user:' || :'bob', false) as ignored \gset
select 'carol joins bob''s topic: ' || (select count(*) from realtime.messages);
set request.jwt.claim.sub = :'dan';
select set_config('realtime.topic', 'chat:' || :'secret', false) as ignored \gset
select 'dan joins the topic of secret: ' || (select count(*) from realtime.messages);
select set_config('realtime.topic', 'chat:not-a-uuid', false) as ignored \gset
select 'a broken topic: ' || (select count(*) from realtime.messages);
reset realtime.topic;

-- Units and guests over time.
set request.jwt.claim.sub = :'bob';
select 'bob sees eu-team: ' || (select count(*) from public.chat_channels where id = :'euch');
set request.jwt.claim.sub = :'alice';
select 'bob leaves EU: ' || (public.set_workspace_group_member(:'ws', :'eu', :'bob', false) ->> 'ok');
set request.jwt.claim.sub = :'bob';
select 'bob sees eu-team now: ' || (select count(*) from public.chat_channels where id = :'euch')
  || ', leads-room: ' || (select count(*) from public.chat_channels where id = :'leadsroom');
reset role;
set request.jwt.claim.sub = :'gwen';
select 'the guest sees bob: ' || public.guest_sees(:'ws', :'bob') || ', dan: ' || public.guest_sees(:'ws', :'dan')
  || ', carol (wrote in general): ' || public.guest_sees(:'ws', :'carol');
update public.workspace_members set access_until = now() - interval '1 day' where user_id = :'gwen';
set role authenticated;
select 'the guest after her access ended sees: ' || :seen || ', reads: ' || (select count(*) from public.chat_messages);
set request.jwt.claim.sub = :'alice';
select 'alice removes carol: ' || (public.remove_member(:'ws', :'carol') ->> 'ok');
reset role;
select 'carol''s chat rows after leaving: ' || (select count(*) from public.chat_channel_members where user_id = :'carol');
