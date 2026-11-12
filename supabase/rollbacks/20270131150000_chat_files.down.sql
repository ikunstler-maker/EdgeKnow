-- Undo 20270131150000_chat_files.

create or replace function public.chat_delete_message(msg uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = msg;
  if not found or m.deleted_at is not null or not public.chat_can_read(m.channel_id)
     or (m.author_id is distinct from auth.uid() and not public.chat_can_manage(m.channel_id)) then
    return public.ws_error('forbidden');
  end if;
  delete from public.chat_reactions where message_id = msg;
  update public.chat_messages set body = '', mentions = '{}', deleted_at = now(), deleted_by = auth.uid(), pinned_at = null, pinned_by = null
  where id = msg;
  if m.thread_root_id is not null then
    update public.chat_messages set reply_count = greatest(reply_count - 1, 0) where id = m.thread_root_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.chat_open_direct(ws uuid, people uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  others uuid[];
  key text;
  found_id uuid;
  made uuid;
  person uuid;
  guest boolean := public.is_guest(ws, auth.uid());
begin
  if not public.is_workspace_member(ws) then
    return public.ws_error('forbidden');
  end if;
  select coalesce(array_agg(distinct p.id), '{}') into others from unnest(coalesce(people, '{}')) p(id) where p.id is not null and p.id <> auth.uid();
  if cardinality(others) not between 1 and 7 then
    return public.ws_error('invalid_people');
  end if;
  foreach person in array others loop
    if not public.is_active_member(ws, person) or (guest and not public.guest_sees(ws, person)) then
      return public.ws_error('not_found');
    end if;
  end loop;
  if cardinality(others) = 1 then
    key := least(auth.uid()::text, others[1]::text) || ':' || greatest(auth.uid()::text, others[1]::text);
    select c.id into found_id from public.chat_channels c where c.workspace_id = ws and c.dm_key = key;
    if found_id is not null then
      -- Someone who left the pair's conversation comes back to it.
      insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited, added_by)
      values (found_id, ws, auth.uid(), true, auth.uid())
      on conflict (channel_id, user_id) do update set invited = true;
      return jsonb_build_object('ok', true, 'id', found_id);
    end if;
  end if;
  if (select count(*) from public.chat_channels c where c.workspace_id = ws) >= 20000 then
    return public.ws_error('too_many');
  end if;
  insert into public.chat_channels (workspace_id, name, visibility, dm_key, created_by)
  values (ws, '', 'direct', key, auth.uid())
  returning id into made;
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, role, invited, added_by)
  select made, ws, p.id, case when p.id = auth.uid() and key is null then 'owner' else 'member' end, true, auth.uid()
  from unnest(others || auth.uid()) p(id);
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

create or replace function public.chat_add_members(ch uuid, user_ids uuid[], show_history boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  person uuid;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) or public.is_guest(c.workspace_id, auth.uid()) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  if c.dm_key is not null then
    return public.ws_error('direct_pair');
  end if;
  if c.visibility = 'direct' and (select count(*) from public.chat_channel_members m where m.channel_id = ch and m.invited)
       + (select count(*) from unnest(user_ids) u(id) where not exists (select 1 from public.chat_channel_members m where m.channel_id = ch and m.user_id = u.id and m.invited)) > 8 then
    return public.ws_error('too_many');
  end if;
  if cardinality(coalesce(user_ids, '{}')) not between 1 and 200 then
    return public.ws_error('invalid_people');
  end if;
  foreach person in array user_ids loop
    if not public.is_active_member(c.workspace_id, person) then
      return public.ws_error('not_found');
    end if;
    if public.is_guest(c.workspace_id, person) and not public.chat_can_manage(ch) and c.visibility <> 'direct' then
      return public.ws_error('forbidden');
    end if;
    if not public.chat_category_open(c.category_id, person) then
      return public.ws_error('no_category_access');
    end if;
  end loop;
  -- Earlier history: as the channel says, unless the person adding chose for these people.
  -- Someone already in keeps what they had.
  insert into public.chat_channel_members (channel_id, workspace_id, user_id, invited, added_by, history_from)
  select distinct ch, c.workspace_id, u.id, true, auth.uid(), case when coalesce(show_history, c.history_visible) then null else now() end
  from unnest(user_ids) u(id)
  on conflict (channel_id, user_id) do update set
    history_from = case when public.chat_channel_members.invited then public.chat_channel_members.history_from else excluded.history_from end,
    invited = true, added_by = excluded.added_by;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.register_task_file(target_task uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks;
  project public.task_projects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into task from public.tasks where id = target_task;
  if not found or task.deleted_at is not null or not public.task_permits(task.id, 'file_add') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.task_files f where f.task_id = target_task) >= 100 then
    return public.page_error('too_many_files');
  end if;
  select * into project from public.task_projects where id = task.project_id;
  -- EdgeKnow's storage has the workspace's limit (wiki images and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = task.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = task.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = task.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := task.workspace_id || '/tasks/' || target_task || '/' || new_id;
  insert into public.task_files (id, workspace_id, task_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, task.workspace_id, target_task, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'target', project.files_target,
                            'workspace_id', task.workspace_id, 'project_id', project.id);
end;
$$;

create or replace function public.register_object_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  object public.service_objects;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into object from public.service_objects where id = target_object;
  if not found or object.deleted_at is not null or object.service not in ('boards', 'slides', 'apps', 'wishlists')
     or public.role_rank(public.service_object_role(target_object)) < public.role_rank('editor') then
    return public.page_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') then
    return public.page_error('invalid_file');
  end if;
  -- A company app's logo: one small picture, 2 MB at most.
  if object.service = 'apps' and file_bytes > 2097152 then
    return public.page_error('too_large');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object) >= 500 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images and task files count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = object.workspace_id and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = object.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = object.workspace_id) then
    return public.page_error('quota_exceeded');
  end if;
  path := object.workspace_id || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, object.workspace_id, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', object.workspace_id);
end;
$$;

create or replace function public.register_survey_file(target_object uuid, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (select o.workspace_id from public.service_objects o where o.id = target_object and o.service = 'surveys' and o.deleted_at is null);
  st public.survey_settings;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if ws is null or public.service_object_role(target_object) is null then
    return public.page_error('forbidden');
  end if;
  select * into st from public.survey_settings where object_id = target_object;
  if not coalesce(st.accepting, true) or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = target_object and f.uploaded_by = auth.uid() and f.created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.object_files f where f.object_id = target_object) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || target_object || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, target_object, btrim(file_name), file_type, file_bytes, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

create or replace function public.register_public_survey_file(token text, file_name text, file_type text, file_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.survey_settings;
  ws uuid;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into st from public.survey_settings s where s.public_token = token and s.public_enabled;
  ws := (select o.workspace_id from public.service_objects o where o.id = st.object_id and o.deleted_at is null);
  if ws is null then
    return public.page_error('not_found');
  end if;
  if not st.accepting or coalesce(st.closes_at <= now(), false) then
    return public.page_error('closed');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 4194304
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation') then
    return public.page_error('invalid_file');
  end if;
  if (select count(*) from public.object_files f where f.object_id = st.object_id and f.created_at > now() - interval '1 hour') >= 300
     or (select count(*) from public.object_files f where f.object_id = st.object_id) >= 2000 then
    return public.page_error('too_many_files');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections c where c.workspace_id = ws and c.active and c.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = ws and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || st.object_id || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, st.object_id, btrim(file_name), file_type, file_bytes, path, null);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

drop function public.chat_post_message(uuid, text, uuid, uuid[], uuid[]);
create function public.chat_post_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  made uuid;
  clean text := btrim(coalesce(new_body, ''));
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  if char_length(clean) not between 1 and 4000 then
    return public.ws_error('invalid_body');
  end if;
  if thread_root is not null and not exists (
    select 1 from public.chat_messages r where r.id = thread_root and r.channel_id = ch and r.thread_root_id is null and r.deleted_at is null
      and public.chat_history_ok(ch, r.created_at)) then
    return public.ws_error('not_found');
  end if;
  if (select count(*) from public.chat_messages m where m.author_id = auth.uid() and m.created_at > now() - interval '1 minute') >= 30 then
    return public.ws_error('rate_limited');
  end if;
  insert into public.chat_messages (workspace_id, channel_id, author_id, thread_root_id, body, mentions)
  values (c.workspace_id, ch, auth.uid(), thread_root, clean, public.chat_clean_mentions(ch, mention_ids))
  returning id into made;
  if thread_root is not null then
    update public.chat_messages set reply_count = reply_count + 1, last_reply_at = now() where id = thread_root;
  end if;
  update public.chat_channel_members set last_read_at = now() where channel_id = ch and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;
revoke execute on function public.chat_post_message(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.chat_post_message(uuid, text, uuid, uuid[]) to authenticated;

drop function public.clean_chat_files();
drop function public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer);
delete from storage.buckets where id = 'chat-files';
drop table public.chat_files;
drop function public.check_chat_file_workspace();
update public.chat_messages set body = '(file)' where deleted_at is null and char_length(btrim(body)) = 0;
alter table public.chat_messages
  drop constraint chat_messages_check,
  add constraint chat_messages_check check (deleted_at is not null or char_length(btrim(body)) >= 1),
  drop column file_count;
