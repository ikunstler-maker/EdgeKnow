-- Notifications: assignment, comments and mentions, page mentions, project rules
-- (a «review» column tells a group), only to people who still see the task, and per-person settings.
\pset format unaligned
\pset tuples_only on
\set VERBOSITY terse

insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000037a1', 'alice@notify.test', now()),
 ('00000000-0000-0000-0000-0000000037b1', 'bob@notify.test', now()),
 ('00000000-0000-0000-0000-0000000037c1', 'carol@notify.test', now()),
 ('00000000-0000-0000-0000-0000000037e1', 'eve@other-notify.test', now());
update public.platform_settings set open_registration = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037a1';
select public.create_workspace('Notify') ->> 'id' as ws \gset
select public.add_workspace_domain(:'ws', 'notify.test') ->> 'ok' as ignored \gset
select public.create_task_project(:'ws', 'Notify', 'NTF', null, null) ->> 'id' as project \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037b1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037c1';
select public.join_workspaces() ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037e1';
select public.create_workspace('Other notify') ->> 'ok' as ignored \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037a1';
select public.create_workspace_group(:'ws', 'Reviewers') ->> 'id' as reviewers \gset
select public.set_workspace_group_member(:'ws', :'reviewers', '00000000-0000-0000-0000-0000000037c1', true) ->> 'ok' as ignored \gset
reset role;
update public.platform_settings set open_registration = false;
select id as doing from public.task_statuses where project_id = :'project' and category = 'doing' \gset

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037a1';
select 'a review column: ' || (public.save_task_status(:'project', null, 'Review', 'review', null, null) ->> 'ok');
select id as review from public.task_statuses where project_id = :'project' and category = 'review' \gset
select 'rule: review tells the reviewers: ' || (public.save_task_rule(:'project', jsonb_build_object('event', 'enter_category', 'category', 'review', 'groups', jsonb_build_array(:'reviewers'))) ->> 'ok');
select 'rule: a column tells the reporter: ' || (public.save_task_rule(:'project', jsonb_build_object('event', 'enter_status', 'status_id', :'doing', 'roles', jsonb_build_array('reporter'))) ->> 'ok');
select 'a rule for nobody: ' || public.save_task_rule(:'project', '{"event": "comment"}')::text;
select 'a person from elsewhere: ' || public.save_task_rule(:'project', '{"event": "comment", "users": ["00000000-0000-0000-0000-0000000037e1"]}')::text;
select public.create_task(:'project', jsonb_build_object('title', 'Ship it', 'assignee_id', '00000000-0000-0000-0000-0000000037b1')) ->> 'id' as task \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037b1';
select 'bob may not add rules: ' || public.save_task_rule(:'project', '{"event": "comment", "roles": ["assignee"]}')::text;
select 'bob moves it to doing: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'doing')) ->> 'ok');
select 'bob moves it to review: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'review')) ->> 'ok');
select 'bob mentions carol: ' || (public.add_task_comment(:'task', 'Please look', array['00000000-0000-0000-0000-0000000037c1']::uuid[]) ->> 'ok');
reset role;
select 'notifications: ' || string_agg(split_part(p.email, '@', 1) || ':' || n.kind, ', ' order by p.email, n.kind)
from public.notifications n join public.profiles p on p.id = n.user_id where n.workspace_id = :'ws';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037c1';
select 'carol sees: ' || (public.my_notifications(:'ws', 10) ->> 'unread') || ' unread, ' || (public.my_notifications(:'ws', 10) -> 'items' -> 0 -> 'task' ->> 'key');
select 'carol reads all: ' || (public.mark_notifications_read(:'ws', null) ->> 'ok');
select 'carol, unread after: ' || (public.my_notifications(:'ws', 10) ->> 'unread');
select 'carol sees only her own rows: ' || count(*) from public.notifications;
select 'carol mutes comments and mentions: ' || (public.set_notification_prefs(:'ws', array['mention', 'comment']) ->> 'ok');
select 'a kind that does not exist: ' || public.set_notification_prefs(:'ws', array['spam'])::text;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037b1';
select 'bob mentions carol again: ' || (public.add_task_comment(:'task', 'Again', array['00000000-0000-0000-0000-0000000037c1']::uuid[]) ->> 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037c1';
select 'carol, muted, got nothing new: ' || (public.my_notifications(:'ws', 10) ->> 'unread');

-- Someone who doesn't see the task hears nothing about it.
reset role;
delete from public.notifications where workspace_id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037a1';
select 'project closed to the workspace: ' || (public.update_task_project(:'project', '{"workspace_role": null}') ->> 'ok');
select 'alice moves it back to doing: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'doing')) ->> 'ok');
select 'alice moves it to review again: ' || (public.update_task(:'task', jsonb_build_object('status_id', :'review')) ->> 'ok');
reset role;
select 'carol, without access, hears nothing (alice moved it herself): ' || coalesce(string_agg(split_part(p.email, '@', 1) || ':' || n.kind, ', '), 'nobody') from public.notifications n join public.profiles p on p.id = n.user_id where n.workspace_id = :'ws';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000037e1';
select 'eve, not a member: ' || (public.my_notifications(:'ws', 10))::text;
set role anon;
select 'anon: ' || public.my_notifications(:'ws', 10)::text;
reset role;

delete from public.workspaces where name in ('Notify', 'Other notify');
delete from auth.users where email like '%notify.test';
