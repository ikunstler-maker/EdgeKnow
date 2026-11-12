-- The same in supabase/team/migrations/0069_chat_mentions.sql.
-- Rollback: supabase/rollbacks/20270124100000_chat_mentions.down.sql

-- Toker, stage 1c: mentions and thread replies in the bell (decision 2026-11-12
-- "Toker, етап 1": mentions in the bell together with the interface).

alter table public.notifications add column chat_message_id uuid references public.chat_messages (id) on delete cascade;
create index notifications_chat_message_idx on public.notifications (chat_message_id) where chat_message_id is not null;
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday', 'chat_mention', 'chat_reply'));

-- One notification about a chat message: only to someone who sees the channel, has
-- not silenced it ("nothing") or muted the kind, and not twice for the same message.
create function public.chat_notify(person uuid, what text, msg public.chat_messages)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only what a signed-in person writes notifies anyone (copies between databases: nobody).
  if auth.uid() is null or person is null or person = msg.author_id or msg.deleted_at is not null then
    return;
  end if;
  if not public.chat_can_see(msg.channel_id, person) then
    return;
  end if;
  if exists (select 1 from public.chat_channel_members m where m.channel_id = msg.channel_id and m.user_id = person and m.notify = 'none') then
    return;
  end if;
  if exists (select 1 from public.notification_prefs p where p.workspace_id = msg.workspace_id and p.user_id = person and what = any (p.muted)) then
    return;
  end if;
  if exists (select 1 from public.notifications n where n.user_id = person and n.chat_message_id = msg.id) then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, kind, actor_id, chat_message_id)
  values (msg.workspace_id, person, what, msg.author_id, msg.id);
end;
$$;

-- New mentions (also those added by an edit) and a reply in the thread of one's message.
create function public.chat_notify_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
  root_author uuid;
begin
  foreach person in array new.mentions loop
    if tg_op = 'INSERT' or not (person = any (old.mentions)) then
      perform public.chat_notify(person, 'chat_mention', new);
    end if;
  end loop;
  if tg_op = 'INSERT' and new.thread_root_id is not null then
    select r.author_id into root_author from public.chat_messages r where r.id = new.thread_root_id;
    if not (root_author = any (new.mentions)) then
      perform public.chat_notify(root_author, 'chat_reply', new);
    end if;
  end if;
  return null;
end;
$$;
create trigger chat_messages_notify after insert or update of mentions on public.chat_messages
  for each row execute function public.chat_notify_message();
revoke execute on function public.chat_notify(uuid, text, public.chat_messages), public.chat_notify_message() from public, anon, authenticated;

create or replace function public.my_notifications(ws uuid, max_rows integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.workspace_id = ws and n.user_id = auth.uid() and n.read_at is null),
    'items', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select n.id, n.kind, n.created_at, n.read_at,
             coalesce(a.name, a.email) as actor,
             case when t.id is not null and public.task_role(t.id) is not null
                  then jsonb_build_object('id', t.id, 'key', p.key || '-' || t.number, 'number', t.number, 'project', p.key, 'title', t.title, 'status', s.name) end as task,
             case when g.id is not null and public.page_role_of(g.id, auth.uid()) is not null
                  then jsonb_build_object('id', g.id, 'title', g.title) end as page,
             case when e.id is not null and public.calendar_event_visible(e.id)
                  then jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(n.event_at, e.starts_at), 'all_day', e.all_day, 'cancelled', e.deleted_at is not null) end as event,
             -- Who and when; the kind of absence stays in the request itself.
             case when l.id is not null and not public.is_guest(ws, auth.uid())
                       and (l.user_id = auth.uid() or l.deputy_id = auth.uid() or public.leave_can_decide(ws, l.user_id, auth.uid()))
                  then jsonb_build_object('id', l.id, 'person', coalesce(lp.name, lp.email), 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status,
                                          'mine', l.user_id = auth.uid(), 'deputy', coalesce(l.deputy_id = auth.uid(), false)) end as leave,
             -- A birthday: whose and which day — while it may still be seen.
             case when n.kind = 'birthday' and public.birthday_visible(ws, n.actor_id)
                  then jsonb_build_object('person', coalesce(a.name, a.email), 'day', (n.event_at at time zone 'UTC')::date) end as birthday,
             -- A chat message: its channel and the start of its text — while the message is there and the channel seen.
             case when cm.id is not null and cm.deleted_at is null and public.chat_can_read(cm.channel_id)
                  then jsonb_build_object('id', cm.id, 'channel_id', cm.channel_id, 'channel', ch.name, 'thread_root_id', cm.thread_root_id,
                                          'excerpt', left(cm.body, 140)) end as chat
      from public.notifications n
      left join public.profiles a on a.id = n.actor_id
      left join public.tasks t on t.id = n.task_id
      left join public.task_projects p on p.id = t.project_id
      left join public.task_statuses s on s.id = coalesce(n.status_id, t.status_id)
      left join public.pages g on g.id = n.page_id and g.deleted_at is null
      left join public.calendar_events e on e.id = n.event_id
      left join public.leave_requests l on l.id = n.leave_request_id
      left join public.profiles lp on lp.id = l.user_id
      left join public.chat_messages cm on cm.id = n.chat_message_id
      left join public.chat_channels ch on ch.id = cm.channel_id
      where n.workspace_id = ws and n.user_id = auth.uid() and public.is_workspace_member(ws)
      order by n.created_at desc
      limit least(greatest(coalesce(max_rows, 30), 1), 100)
    ) x), '[]'::jsonb));
$$;

create or replace function public.set_notification_prefs(ws uuid, new_muted text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(ws) then
    return public.page_error('forbidden');
  end if;
  if not coalesce(new_muted, '{}') <@ array['mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                                           'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday', 'chat_mention', 'chat_reply']::text[] then
    return public.page_error('invalid');
  end if;
  insert into public.notification_prefs (workspace_id, user_id, muted)
  values (ws, auth.uid(), coalesce(new_muted, '{}'))
  on conflict (workspace_id, user_id) do update set muted = excluded.muted, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
