-- Undo 0075_wishlist_gifts.
create or replace function public.calendar_forget_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_external_busy where workspace_id = old.workspace_id and user_id = old.user_id;
  -- Their birthday and job title are forgotten too (the start date stays for the time-off records).
  update public.leave_member_settings set birth_month = null, birth_day = null, birth_year = null, birthday_shown = true, job_title = null
  where workspace_id = old.workspace_id and user_id = old.user_id and (birth_month is not null or job_title is not null);
  return null;
end;
$$;

create or replace function public.delete_wishlist(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.wishlist_role_of(target, auth.uid()) is distinct from 'owner' then
    return public.page_error('forbidden');
  end if;
  delete from public.service_objects where id = target;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_service_object(target_object uuid, new_title text, new_data jsonb, base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(coalesce(new_title, object.title)) > 200 then
    return public.page_error('title_too_long');
  end if;
  if new_data is not null and pg_column_size(new_data) > 1048576 then
    return public.page_error('too_large');
  end if;
  if object.service = 'apps' and new_data is not null and not public.app_data_ok(new_data) then
    return public.page_error('invalid');
  end if;
  -- A wishlist keeps its birthday and publication (changed by their own functions).
  if object.service = 'wishlists' and new_data is not null then
    new_data := new_data || jsonb_build_object('birthday', object.data -> 'birthday', 'published', coalesce(object.data -> 'published', 'false'::jsonb));
    if not public.wishlist_data_ok(new_data) then
      return public.page_error('invalid');
    end if;
  end if;
  if base_version is distinct from object.version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'version', object.version);
  end if;
  update public.service_objects set
    title = coalesce(btrim(new_title), title),
    data = coalesce(new_data, data),
    search_text = case when new_data is not null then public.service_object_text(new_data) else search_text end,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_object;
  -- Pictures no wish uses any more (and older than an hour, so a fresh upload is safe) go.
  if object.service = 'wishlists' and new_data is not null then
    delete from public.object_files f where f.object_id = target_object and f.created_at < now() - interval '1 hour'
      and not exists (select 1 from jsonb_array_elements(new_data -> 'items') i where i ->> 'image' = f.id::text);
  end if;
  return jsonb_build_object('ok', true, 'version', object.version + 1);
end;
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

drop function public.wishlist_notify_gone(uuid, text[], text);
drop function public.wishlist_claimed_items(uuid);
drop function public.wishlist_gifts_of(uuid);
drop function public.wishlist_ungift(uuid, text);
drop function public.wishlist_gift(uuid, text, text);
delete from public.notifications where kind in ('wishlist_item_removed', 'wishlist_deleted');
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('mention', 'assigned', 'comment', 'rule', 'due', 'event_invite', 'event_request', 'event_answer', 'event_change', 'event_reminder',
                    'leave_request', 'leave_decision', 'leave_deputy', 'leave_info', 'birthday', 'chat_mention', 'chat_reply'));
alter table public.notifications drop column detail;
drop table public.wishlist_gifts;
drop function public.check_wishlist_gift_workspace();
