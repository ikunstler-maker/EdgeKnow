-- Undo 0068_chat.
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
