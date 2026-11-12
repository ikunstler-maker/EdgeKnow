-- Undo 20270202150000_chat_publish.
drop function public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer, smallint[]);
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
revoke execute on function public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer) from public, anon;
grant execute on function public.register_chat_file(uuid, text, text, integer, text, integer, integer, integer) to authenticated;

create or replace function public.chat_my_channels(ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.category_position nulls first, x.position, x.name), '[]'::jsonb) from (
    select c.id, c.name, c.topic, c.kind, c.visibility, c.category_id, c.unit_id, c.position, c.archived_at,
           k.position as category_position, c.history_visible,
           -- A conversation is named by its people (the others first).
           case when c.visibility = 'direct' then (
             select coalesce(jsonb_agg(p.user_id order by p.user_id = auth.uid(), p.joined_at), '[]'::jsonb)
             from public.chat_channel_members p where p.channel_id = c.id and p.invited) end as people,
           (m.user_id is not null or c.visibility in ('closed', 'direct')) as joined,
           m.role, coalesce(m.notify, 'all') as notify, m.last_read_at,
           case when m.user_id is not null or c.visibility in ('closed', 'direct') then (
             select count(*) from (select 1 from public.chat_messages msg
               where msg.channel_id = c.id and msg.deleted_at is null and msg.author_id is distinct from auth.uid()
                 and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz) and msg.created_at >= coalesce(m.history_from, '-infinity'::timestamptz) limit 100) u)
           else 0 end as unread,
           case when m.user_id is not null or c.visibility in ('closed', 'direct') then exists (
             select 1 from public.chat_messages msg
             where msg.channel_id = c.id and msg.deleted_at is null and auth.uid() = any (msg.mentions)
               and msg.created_at > coalesce(m.last_read_at, m.joined_at, '-infinity'::timestamptz) and msg.created_at >= coalesce(m.history_from, '-infinity'::timestamptz))
           else false end as mentioned
    from public.chat_channels c
    left join public.chat_categories k on k.id = c.category_id
    left join public.chat_channel_members m on m.channel_id = c.id and m.user_id = auth.uid()
    where c.workspace_id = ws and public.is_workspace_member(ws) and public.chat_can_see(c.id, auth.uid())
  ) x;
$$;

create or replace function public.chat_post_message(ch uuid, new_body text, thread_root uuid, mention_ids uuid[], file_ids uuid[] default null)
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

drop function public.chat_set_member_can_post(uuid, uuid, boolean);
drop function public.chat_set_post_policy(uuid, text);
drop function public.chat_can_publish(uuid);
alter table public.chat_files drop column waveform;
revoke select (can_post) on public.chat_channel_members from authenticated;
alter table public.chat_channel_members drop column can_post;
alter table public.chat_channels drop constraint chat_channels_post_policy_check2, drop column post_policy;
