-- The same in supabase/team/migrations/0074_chat_files.sql.
-- Rollback: supabase/rollbacks/20270131150000_chat_files.down.sql

-- Toker, stage 2b: files and voice messages in chat (decision 2026-11-12 "Toker, етап 2").
-- A file is uploaded first (a record here, the bytes checked by their first bytes and
-- stored by the server in the workspace's one storage: its Drive or the private
-- "chat-files" bucket), then sent with a message. Who sees the message sees its files;
-- one's own unsent files are seen only by oneself. Deleting the message deletes them.
-- Group conversations now take up to 50 people (owner, 2026-11-12).

create table public.chat_files (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  channel_id       uuid not null references public.chat_channels (id) on delete cascade,
  message_id       uuid references public.chat_messages (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  mime_type        text not null,
  bytes            integer not null check (bytes between 1 and 10485760),
  kind             text not null default 'file' check (kind in ('file', 'image', 'voice')),
  duration_ms      integer check (duration_ms between 0 and 300000),
  width            integer check (width > 0),
  height           integer check (height > 0),
  -- <workspace id>/chat/<channel id>/<file id>
  storage_path     text not null unique,
  storage_backend  text not null default 'pending' check (storage_backend in ('pending', 'supabase', 'drive')),
  drive_source     text check (drive_source in ('personal', 'wiki', 'project')),
  drive_account_id uuid,
  drive_file_id    text,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index chat_files_message_idx on public.chat_files (message_id) where message_id is not null;
create index chat_files_pending_idx on public.chat_files (uploaded_by, created_at) where message_id is null;
create index chat_files_ws_idx on public.chat_files (workspace_id, storage_backend);

alter table public.chat_messages
  add column file_count smallint not null default 0 check (file_count between 0 and 10),
  drop constraint chat_messages_check,
  add constraint chat_messages_check check (deleted_at is not null or char_length(btrim(body)) >= 1 or file_count > 0);

create function public.check_chat_file_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from (select c.workspace_id from public.chat_channels c where c.id = new.channel_id)
     or (new.message_id is not null and new.channel_id is distinct from (select m.channel_id from public.chat_messages m where m.id = new.message_id)) then
    raise exception 'chat_workspace_mismatch';
  end if;
  return new;
end;
$$;
create trigger chat_files_workspace before insert or update of workspace_id, channel_id, message_id on public.chat_files
  for each row execute function public.check_chat_file_workspace();
-- A removed file is deleted from its storage by the daily cleanup.
create trigger chat_files_tombstone after delete on public.chat_files
  for each row execute function public.remember_deleted_task_file();
revoke execute on function public.check_chat_file_workspace() from public, anon, authenticated;

alter table public.chat_files enable row level security;
revoke all on public.chat_files from public, anon, authenticated;
grant select on public.chat_files to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.chat_files to service_role;
  end if;
end $$;
create policy "Files of the messages the person sees, and one's own unsent ones" on public.chat_files
  for select to authenticated
  using (case when message_id is null then uploaded_by = auth.uid() and public.chat_can_read(channel_id)
              else public.chat_can_read(channel_id) and public.chat_message_history_ok(message_id) end);

-- The bytes in EdgeKnow's storage (or the team's own): a private bucket only the server touches.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, array[
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Step 1 of adding a file to a message: a record and its path (whoever may write in the
-- channel). The server then checks the bytes and stores them; the file is sent with
-- chat_post_message. At most 20 unsent files per person; sizes and kinds checked here.
create function public.register_chat_file(ch uuid, file_name text, file_type text, file_bytes integer, file_kind text, duration integer, file_width integer, file_height integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  new_id uuid := gen_random_uuid();
  path text;
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) or c.archived_at is not null then
    return public.ws_error('forbidden');
  end if;
  if char_length(btrim(coalesce(file_name, ''))) not between 1 and 200 or file_bytes is null or file_bytes not between 1 and 10485760
     or coalesce(file_kind, 'file') not in ('file', 'image', 'voice')
     or file_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
       'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg')
     or (file_kind = 'image' and file_type not like 'image/%')
     or (file_kind = 'voice' and (file_type not like 'audio/%' or duration is null or duration not between 0 and 300000)) then
    return public.ws_error('invalid_file');
  end if;
  if (select count(*) from public.chat_files f where f.uploaded_by = auth.uid() and f.message_id is null) >= 20 then
    return public.ws_error('too_many');
  end if;
  -- EdgeKnow's storage has the workspace's limit (wiki images, task files and board pictures count too).
  if not exists (select 1 from public.drive_connections dc where dc.workspace_id = c.workspace_id and dc.active and dc.status = 'ok') and
     (select coalesce(sum(a.bytes), 0) from public.attachments a where a.workspace_id = c.workspace_id and a.storage_backend = 'supabase')
     + (select coalesce(sum(f.bytes), 0) from public.task_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.object_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = c.workspace_id and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = c.workspace_id) then
    return public.ws_error('quota_exceeded');
  end if;
  path := c.workspace_id || '/chat/' || ch || '/' || new_id;
  insert into public.chat_files (id, workspace_id, channel_id, name, mime_type, bytes, kind, duration_ms, width, height, storage_path, uploaded_by)
  values (new_id, c.workspace_id, ch, btrim(file_name), file_type, file_bytes, coalesce(file_kind, 'file'),
          case when file_kind = 'voice' then duration end,
          case when file_width > 0 then file_width end, case when file_height > 0 then file_height end, path, auth.uid());
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', c.workspace_id);
end;
$$;

-- Unsent files left for over a day go (the daily cleanup; server only).
create function public.clean_chat_files()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.chat_files f where f.message_id is null and f.created_at < now() - interval '1 day' returning 1
  )
  select count(*)::integer from gone;
$$;
revoke execute on function public.clean_chat_files() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clean_chat_files() to service_role;
  end if;
end $$;

drop function public.chat_post_message(uuid, text, uuid, uuid[]);
create function public.chat_post_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[], file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chat_channels;
  made uuid;
  clean text := btrim(coalesce(new_body, ''));
  files uuid[] := coalesce((select array_agg(distinct f) from unnest(coalesce(file_ids, '{}')) f where f is not null), '{}');
begin
  select * into c from public.chat_channels where id = ch;
  if not found or not public.chat_can_read(ch) then
    return public.ws_error('forbidden');
  end if;
  if c.archived_at is not null then
    return public.ws_error('archived');
  end if;
  -- Text, files, or both (up to 10 files, uploaded by the writer to this channel, not sent yet).
  if char_length(clean) > 4000 or (char_length(clean) = 0 and cardinality(files) = 0) then
    return public.ws_error('invalid_body');
  end if;
  if cardinality(files) > 10 or (select count(*) from public.chat_files f where f.id = any (files) and f.channel_id = ch
       and f.uploaded_by = auth.uid() and f.message_id is null and f.storage_backend <> 'pending') <> cardinality(files) then
    return public.ws_error('invalid_files');
  end if;
  if thread_root is not null and not exists (
    select 1 from public.chat_messages r where r.id = thread_root and r.channel_id = ch and r.thread_root_id is null and r.deleted_at is null
      and public.chat_history_ok(ch, r.created_at)) then
    return public.ws_error('not_found');
  end if;
  if (select count(*) from public.chat_messages m where m.author_id = auth.uid() and m.created_at > now() - interval '1 minute') >= 30 then
    return public.ws_error('rate_limited');
  end if;
  insert into public.chat_messages (workspace_id, channel_id, author_id, thread_root_id, body, mentions, file_count)
  values (c.workspace_id, ch, auth.uid(), thread_root, clean, public.chat_clean_mentions(ch, mention_ids), cardinality(files))
  returning id into made;
  update public.chat_files set message_id = made where id = any (files);
  if thread_root is not null then
    update public.chat_messages set reply_count = reply_count + 1, last_reply_at = now() where id = thread_root;
  end if;
  update public.chat_channel_members set last_read_at = now() where channel_id = ch and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', made);
end;
$$;

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
  -- Its files go too (their bytes are removed from storage by the daily cleanup).
  delete from public.chat_files where message_id = msg;
  update public.chat_messages set body = '', mentions = '{}', file_count = 0, deleted_at = now(), deleted_by = auth.uid(), pinned_at = null, pinned_by = null
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
  if cardinality(others) not between 1 and 49 then
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
       + (select count(*) from unnest(user_ids) u(id) where not exists (select 1 from public.chat_channel_members m where m.channel_id = ch and m.user_id = u.id and m.invited)) > 50 then
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
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = task.workspace_id and f.storage_backend in ('pending', 'supabase'))
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
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = object.workspace_id and f.storage_backend in ('pending', 'supabase'))
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
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
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
     + (select coalesce(sum(f.bytes), 0) from public.chat_files f where f.workspace_id = ws and f.storage_backend in ('pending', 'supabase'))
     + file_bytes > (select w.storage_limit_mb::bigint * 1048576 from public.workspaces w where w.id = ws) then
    return public.page_error('quota_exceeded');
  end if;
  path := ws || '/objects/' || st.object_id || '/' || new_id;
  insert into public.object_files (id, workspace_id, object_id, name, mime_type, bytes, storage_path, uploaded_by)
  values (new_id, ws, st.object_id, btrim(file_name), file_type, file_bytes, path, null);
  return jsonb_build_object('ok', true, 'id', new_id, 'path', path, 'workspace_id', ws);
end;
$$;

revoke execute on function public.chat_post_message(uuid, text, uuid, uuid[], uuid[]), public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer) from public, anon;
grant execute on function public.chat_post_message(uuid, text, uuid, uuid[], uuid[]), public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer) to authenticated;
