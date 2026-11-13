-- Toker, stage 2c: search finds only what the person sees; messages planned for later
-- are seen only by their author, go out once when due (as the author, if still allowed).
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000086a1', 'alice@later.test', now()),
 ('00000000-0000-0000-0000-0000000086b1', 'bob@later.test', now()),
 ('00000000-0000-0000-0000-0000000086c1', 'carol@later.test', now()),
 ('00000000-0000-0000-0000-0000000086f1', 'eve@other-later.test', now());
\set alice '00000000-0000-0000-0000-0000000086a1'
\set bob '00000000-0000-0000-0000-0000000086b1'
\set carol '00000000-0000-0000-0000-0000000086c1'
\set eve '00000000-0000-0000-0000-0000000086f1'
\set found '(select coalesce(string_agg(x ->> ''body'', '', '' order by x ->> ''body''), ''nothing'') from jsonb_array_elements(public.chat_search(:''ws'', ''budget'')) x)'
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = :'alice';
select public.create_workspace('Later') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'later.test') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'bob';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'carol';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = :'eve';
select public.create_workspace('Elsewhere') ->> 'id' as ignored \gset

-- Search.
set request.jwt.claim.sub = :'bob';
select public.chat_create_channel(:'ws', null, 'general', '', false, null) ->> 'id' as general \gset
select public.chat_create_channel(:'ws', null, 'secret', '', true, null) ->> 'id' as secret \gset
select public.chat_post_message(:'general', 'The budget for May', null, null) ->> 'id' as may \gset
select public.chat_post_message(:'secret', 'Secret budget numbers', null, null) ->> 'id' as ignored \gset
select public.chat_post_message(:'general', 'Budget 100% (a_b)', :'may', null) ->> 'id' as ignored \gset
select 'bob finds: ' || :found;
select 'bob in general only: ' || jsonb_array_length(public.chat_search(:'ws', 'budget', :'general'));
select 'one letter: ' || jsonb_array_length(public.chat_search(:'ws', 'b'));
select 'a percent sign is a sign, not a wildcard: ' || jsonb_array_length(public.chat_search(:'ws', '100%'));
set request.jwt.claim.sub = :'carol';
select 'carol finds: ' || :found;
set request.jwt.claim.sub = :'eve';
select 'a stranger finds: ' || :found;

-- Later.
set request.jwt.claim.sub = :'bob';
select public.chat_schedule_message(:'general', 'Good morning', null, array[:'carol']::uuid[], now() + interval '1 hour') ->> 'id' as morning \gset
select public.chat_schedule_message(:'general', 'Reply later', :'may', null, now() + interval '2 hours') ->> 'id' as reply \gset
select 'too soon: ' || (public.chat_schedule_message(:'general', 'x', null, null, now()) ->> 'error')
  || ', in two years: ' || (public.chat_schedule_message(:'general', 'x', null, null, now() + interval '2 years') ->> 'error')
  || ', in his own new closed channel: ' || (public.chat_schedule_message((select public.chat_create_channel(:'ws', null, 'temp', '', true, null) ->> 'id')::uuid, 'x', null, null, now() + interval '1 hour') ->> 'ok');
select 'bob sees his planned: ' || (select count(*) from public.chat_scheduled);
set request.jwt.claim.sub = :'carol';
select 'carol sees bob''s planned: ' || (select count(*) from public.chat_scheduled)
  || ', cancels one: ' || (public.chat_cancel_scheduled(:'morning') ->> 'error');
select 'nothing due yet: ' || public.chat_send_due(:'ws');
reset role;
update public.chat_scheduled set send_at = now() - interval '1 minute' where id in (:'morning', :'reply');
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'carol''s page sends what is due: ' || public.chat_send_due(:'ws');
select 'and not twice: ' || public.chat_send_due(:'ws');
select 'sent as bob: ' || (select string_agg(m.body || ' by ' || (m.author_id = :'bob'), ', ' order by m.body) from public.chat_messages m where m.body in ('Good morning', 'Reply later'));
select 'the thread counts it: ' || (select reply_count from public.chat_messages where id = :'may');
select 'carol''s bell (mentioned): ' || (select count(*) from jsonb_array_elements(public.my_notifications(:'ws', 30) -> 'items') x where x ->> 'kind' = 'chat_mention');
-- Bob can no longer publish there: his planned message is dropped, not sent.
set request.jwt.claim.sub = :'bob';
select public.chat_schedule_message(:'general', 'Too late', null, null, now() + interval '1 hour') ->> 'ok' as ignored \gset
select public.chat_set_post_policy(:'general', 'chosen') ->> 'ok' as ignored \gset
select public.chat_set_member_role(:'general', :'carol', 'owner') ->> 'ok' as ignored \gset
reset role;
update public.chat_channel_members set role = 'member' where channel_id = :'general' and user_id = :'bob';
update public.chat_scheduled set send_at = now() - interval '1 minute';
set role authenticated;
set request.jwt.claim.sub = :'carol';
select 'when bob may no longer publish in general: ' || public.chat_send_due(:'ws') || ' sent (the other channel), ' || (select count(*) from public.chat_messages where body = 'Too late') || ' there';
reset role;
select 'left planned: ' || (select count(*) from public.chat_scheduled where channel_id = :'general');
