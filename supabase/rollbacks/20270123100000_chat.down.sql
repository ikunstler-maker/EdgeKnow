-- Undo 20270123100000_chat.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "Chat topics of the channels the person sees" on realtime.messages';
  end if;
end;
$$;
drop trigger workspace_members_drop_chat_access on public.workspace_members;
drop table public.chat_reactions;
drop table public.chat_messages;
drop table public.chat_channel_members;
drop table public.chat_channels;
drop table public.chat_category_access;
drop table public.chat_categories;
drop function public.chat_toggle_reaction(uuid, text);
drop function public.chat_pin_message(uuid, boolean);
drop function public.chat_delete_message(uuid);
drop function public.chat_edit_message(uuid, text, uuid[]);
drop function public.chat_post_message(uuid, text, uuid, uuid[]);
drop function public.chat_clean_mentions(uuid, uuid[]);
drop function public.chat_my_channels(uuid);
drop function public.chat_set_notify(uuid, text);
drop function public.chat_mark_read(uuid, timestamptz);
drop function public.chat_own_row(uuid);
drop function public.chat_set_member_role(uuid, uuid, text);
drop function public.chat_remove_member(uuid, uuid);
drop function public.chat_add_members(uuid, uuid[]);
drop function public.chat_leave_channel(uuid);
drop function public.chat_join_channel(uuid);
drop function public.chat_delete_channel(uuid);
drop function public.chat_archive_channel(uuid, boolean);
drop function public.chat_update_channel(uuid, text, text, uuid, uuid);
drop function public.chat_create_channel(uuid, uuid, text, text, boolean, uuid);
drop function public.chat_set_category_access(uuid, uuid, uuid[], uuid[]);
drop function public.chat_reorder_categories(uuid, uuid[]);
drop function public.chat_delete_category(uuid, uuid);
drop function public.chat_save_category(uuid, uuid, text, boolean);
drop function public.drop_chat_access_of_removed_member();
drop function public.chat_signal_change();
drop function public.chat_signal(text, text, jsonb);
drop function public.chat_admin_of(uuid);
drop function public.chat_category_visible(uuid);
drop function public.chat_topic_allowed(text);
drop function public.chat_can_manage(uuid);
drop function public.chat_can_read(uuid);
drop function public.chat_can_see(uuid, uuid);
drop function public.chat_category_open(uuid, uuid);
drop function public.chat_is_admin(uuid, uuid);
drop function public.check_chat_workspace();

create or replace function public.role_permission_default(perm text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select perm in ('create_pages', 'create_objects', 'manage_collections');
$$;

create or replace function public.save_workspace_role(ws uuid, role_id uuid, new_name text, new_permissions jsonb, new_level text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  known text[] := array['create_pages', 'create_projects', 'create_objects', 'manage_collections', 'manage_fields', 'invite', 'manage_structure', 'manage_leave'];
  clean jsonb;
  saved uuid;
  kind text;
begin
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active') then
    perform public.log_workspace_action(ws, 'access_denied', jsonb_build_object('attempted', 'save_role'));
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(new_name, ''))) not between 1 and 60 then
    return public.ws_error('invalid_name');
  end if;
  if new_level is not null and new_level not in ('viewer', 'commenter', 'editor') then
    return public.ws_error('invalid_role');
  end if;
  if jsonb_typeof(coalesce(new_permissions, '{}'::jsonb)) <> 'object' then
    return public.ws_error('invalid_role');
  end if;
  clean := coalesce((select jsonb_object_agg(k, (new_permissions ->> k)::boolean) from unnest(known) k where new_permissions ? k
                     and jsonb_typeof(new_permissions -> k) = 'boolean'), '{}'::jsonb);
  if role_id is null then
    if (select count(*) from public.workspace_roles r where r.workspace_id = ws) >= 50 then
      return public.ws_error('too_many');
    end if;
    insert into public.workspace_roles (workspace_id, name, permissions, content_level, position)
    values (ws, btrim(new_name), clean, new_level, coalesce((select max(r.position) from public.workspace_roles r where r.workspace_id = ws), 1) + 1)
    returning id into saved;
  else
    select r.builtin into kind from public.workspace_roles r where r.id = role_id and r.workspace_id = ws;
    if not found then
      return public.ws_error('not_found');
    end if;
    -- The admin row keeps every right and no ceiling; only its name changes.
    update public.workspace_roles r set
      name = btrim(new_name),
      permissions = case when kind = 'admin' then '{}'::jsonb else clean end,
      content_level = case when kind = 'admin' then null else new_level end
    where r.id = role_id
    returning r.id into saved;
  end if;
  perform public.log_workspace_action(ws, 'role_saved', jsonb_build_object('role', btrim(new_name)));
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;


create or replace function public.guest_sees(ws uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws and m.user_id = other and m.status = 'active' and m.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.page_access mine
      join public.page_access theirs on theirs.page_id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.page_access mine
      join public.pages p on p.id = mine.page_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (p.owner_id, p.updated_by)
    )
    or exists (
      select 1 from public.page_access mine
      join public.comment_threads t on t.page_id = mine.page_id
      join public.comments c on c.thread_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.task_project_access theirs on theirs.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (t.assignee_id, t.reporter_id, t.updated_by)
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_comments c on c.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and c.author_id = other
    )
    or exists (
      select 1 from public.task_project_access mine
      join public.tasks t on t.project_id = mine.project_id
      join public.task_events e on e.task_id = t.id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and e.actor_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_object_access theirs on theirs.object_id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and theirs.user_id = other
    )
    or exists (
      select 1 from public.service_object_access mine
      join public.service_objects o on o.id = mine.object_id
      where mine.workspace_id = ws and mine.user_id = auth.uid() and other in (o.owner_id, o.updated_by)
    );
$$;

create or replace function public.team_move_people(ws uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with ids as (
    select owner_id as id from public.pages where workspace_id = ws
    union select created_by from public.pages where workspace_id = ws
    union select updated_by from public.pages where workspace_id = ws
    union select deleted_by from public.pages where workspace_id = ws
    union select user_id from public.page_access where workspace_id = ws
    union select granted_by from public.page_access where workspace_id = ws
    union select created_by from public.comment_threads where workspace_id = ws
    union select resolved_by from public.comment_threads where workspace_id = ws
    union select author_id from public.comments where workspace_id = ws
    union select uploaded_by from public.attachments where workspace_id = ws
    union select user_id from public.page_mentions where workspace_id = ws
    union select mentioned_by from public.page_mentions where workspace_id = ws
    union select user_id from public.page_contributions where workspace_id = ws
    union select actor_id from public.audit_log where workspace_id = ws
    union select user_id from public.workspace_members where workspace_id = ws
    union select owner_id from public.workspaces where id = ws
    union select reporter_id from public.tasks where workspace_id = ws
    union select assignee_id from public.tasks where workspace_id = ws
    union select updated_by from public.tasks where workspace_id = ws
    union select deleted_by from public.tasks where workspace_id = ws
    union select author_id from public.task_comments where workspace_id = ws
    union select actor_id from public.task_events where workspace_id = ws
    union select user_id from public.task_project_access where workspace_id = ws
    union select created_by from public.task_projects where workspace_id = ws
    union select owner_id from public.service_objects where workspace_id = ws
    union select created_by from public.service_objects where workspace_id = ws
    union select updated_by from public.service_objects where workspace_id = ws
    union select deleted_by from public.service_objects where workspace_id = ws
    union select user_id from public.service_object_access where workspace_id = ws
    union select organizer_id from public.calendar_events where workspace_id = ws
    union select created_by from public.calendar_events where workspace_id = ws
    union select deleted_by from public.calendar_events where workspace_id = ws
    union select user_id from public.calendar_event_attendees where workspace_id = ws
    union select invited_by from public.calendar_event_attendees where workspace_id = ws
    union select updated_by from public.calendar_settings where workspace_id = ws
    union select updated_by from public.calendar_event_exceptions where workspace_id = ws
    union select created_by from public.leave_holidays where workspace_id = ws
    union select user_id from public.leave_member_settings where workspace_id = ws
    union select updated_by from public.leave_member_settings where workspace_id = ws
    union select created_by from public.leave_policies where workspace_id = ws
    union select user_id from public.leave_balances where workspace_id = ws
    union select created_by from public.leave_balances where workspace_id = ws
    union select user_id from public.leave_requests where workspace_id = ws
    union select deputy_id from public.leave_requests where workspace_id = ws
    union select decided_by from public.leave_requests where workspace_id = ws
    union select cancelled_by from public.leave_requests where workspace_id = ws
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.name, 'avatar_url', p.avatar_url, 'created_at', p.created_at) order by p.id), '[]')
  from public.profiles p where p.id in (select id from ids where id is not null);
$function$;
