-- Toker, stage 3c-2: a time-off request waiting for a decision becomes a system message
-- in the requester's conversation with each decider; nobody else sees it; nobody can
-- write, edit or delete one; a decision signals it; copying data writes nothing new.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000098a1', 'alice@cards.test', now()),
 ('00000000-0000-0000-0000-0000000098b1', 'bob@cards.test', now()),
 ('00000000-0000-0000-0000-0000000098c1', 'carol@cards.test', now()),
 ('00000000-0000-0000-0000-0000000098d1', 'dave@cards.test', now());
\set alice '00000000-0000-0000-0000-0000000098a1'
\set bob '00000000-0000-0000-0000-0000000098b1'
\set carol '00000000-0000-0000-0000-0000000098c1'
\set dave '00000000-0000-0000-0000-0000000098d1'
\set cards '(select count(*) from public.chat_messages where kind = ''system'')'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Cards') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'cards.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'dave';
select public.join_workspaces() ->> 'ok' as ignored \gset

-- Units: Marketing (Carol leads) > Design (Bob and Dave).
set request.jwt.claim.sub = :'alice';
select public.create_workspace_group(:'ws', 'Marketing', null) ->> 'id' as marketing \gset
select public.create_workspace_group(:'ws', 'Design', :'marketing') ->> 'id' as design \gset
select public.set_workspace_group_member(:'ws', :'marketing', :'carol', true) ->> 'ok' as ignored \gset
select public.set_group_lead(:'ws', :'marketing', :'carol', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'bob', true) ->> 'ok' as ignored \gset
select public.set_workspace_group_member(:'ws', :'design', :'dave', true) ->> 'ok' as ignored \gset
select public.seed_leave_policies(:'ws', '{"vacation": "Vacation", "sick": "Sick leave", "day_off": "Day off", "remote": "Remote work"}') ->> 'ok' as ignored \gset
select id as vacation from public.leave_policies where workspace_id = :'ws' and kind = 'vacation' \gset
select id as sick from public.leave_policies where workspace_id = :'ws' and kind = 'sick' \gset
select public.save_leave_policy(:'ws', :'vacation', '{"name": "Vacation", "kind": "vacation", "days_per_year": 20}') ->> 'ok' as ignored \gset
select extract(year from now())::int + 1 as y \gset
select public.accrue_leave_year(:'ws', :'vacation', :y - 1) ->> 'ok' as ignored \gset
select public.accrue_leave_year(:'ws', :'vacation', :y) ->> 'ok' as ignored \gset
select (d + ((8 - extract(isodow from d)::int) % 7))::date as mon from (select make_date(:y, 7, 1) as d) x \gset

-- Bob asks for a week: a card in his conversation with Carol (the lead above him).
set request.jwt.claim.sub = :'bob';
select public.request_leave(:'ws', :'vacation', :'mon'::date, :'mon'::date + 4, null, null, 'Sea') ->> 'id' as week \gset
select 'the request waits: ' || (select status from public.leave_requests where id = :'week');
select 'bob sees cards: ' || :cards;
select c.id as pair from public.chat_channels c join public.chat_messages m on m.channel_id = c.id where m.leave_request_id = :'week' \gset
select 'in a conversation of: ' || (select string_agg(case user_id when :'bob' then 'bob' when :'carol' then 'carol' else 'someone else' end, ', ' order by user_id) from public.chat_channel_members where channel_id = :'pair' and invited)
  || ', direct: ' || (select visibility from public.chat_channels where id = :'pair');
set request.jwt.claim.sub = :'carol';
select 'carol sees cards: ' || :cards || ', unread there: ' || (select x ->> 'unread' from jsonb_array_elements(public.chat_my_channels(:'ws')) x where x ->> 'id' = :'pair')
  || ', the request: ' || (select status from public.leave_requests where id = :'week');
set request.jwt.claim.sub = :'dave';
select 'dave sees cards: ' || :cards || ', the request: ' || (select count(*) from public.leave_requests where id = :'week');
set request.jwt.claim.sub = :'alice';
select 'alice (owner) sees cards: ' || :cards;

-- A request that needs no decision writes nothing.
set request.jwt.claim.sub = :'dave';
select 'dave is sick: ' || (public.request_leave(:'ws', :'sick', :'mon'::date + 7, :'mon'::date + 7, null, null, '') ->> 'status');
set request.jwt.claim.sub = :'carol';
select 'cards now: ' || :cards;

-- A system message can't be written, edited or deleted.
set request.jwt.claim.sub = :'bob';
select id as card from public.chat_messages where leave_request_id = :'week' \gset
select 'bob edits it: ' || (public.chat_edit_message(:'card', 'Approved!', null) ->> 'ok');
select 'bob deletes it: ' || (public.chat_delete_message(:'card') ->> 'ok');
insert into public.chat_messages (workspace_id, channel_id, author_id, body, kind) values (:'ws', :'pair', :'bob', '', 'system');
select 'still one card, unchanged: ' || (select count(*) || ' ' || coalesce(nullif(body, ''), '(empty)') || ' ' || (deleted_at is null) from public.chat_messages where kind = 'system' group by body, deleted_at);
select 'a reply in its thread: ' || (public.chat_post_message(:'pair', 'Thanks in advance', :'card', null) ->> 'ok');

-- Carol decides: the card is signalled, the request approved; the reply stays.
set request.jwt.claim.sub = :'carol';
select 'carol approves: ' || (public.decide_leave_request(:'week', true, '') ->> 'ok');
select 'the request: ' || (select status from public.leave_requests where id = :'week')
  || ', replies kept: ' || (select reply_count from public.chat_messages where id = :'card');

-- A second request goes into the same conversation.
set request.jwt.claim.sub = :'bob';
select 'second request: ' || (public.request_leave(:'ws', :'vacation', :'mon'::date + 14, :'mon'::date + 15, null, null, '') ->> 'status');
select 'cards: ' || :cards || ', conversations: ' || (select count(distinct channel_id) from public.chat_messages where kind = 'system');

-- Copying data (no person behind the insert) writes no cards.
reset role;
reset request.jwt.claim.sub;
select 'before a copy: ' || (select count(*) from public.chat_messages where kind = 'system' and workspace_id = :'ws');
insert into public.leave_requests (workspace_id, user_id, policy_id, start_date, end_date, days, status)
values (:'ws', :'bob', :'vacation', :'mon'::date + 21, :'mon'::date + 21, 1, 'pending');
select 'after a copy: ' || (select count(*) from public.chat_messages where kind = 'system' and workspace_id = :'ws');
-- A deleted request leaves the card without it.
delete from public.leave_requests where id = :'week';
select 'request gone, card kept: ' || (select count(*) from public.chat_messages where id = :'card' and leave_request_id is null);
