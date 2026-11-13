-- Undo 0080_toker_leave_cards.
drop trigger leave_requests_chat_touch on public.leave_requests;
drop function public.chat_leave_touch();
drop trigger leave_requests_chat_post on public.leave_requests;
drop function public.chat_leave_post();
drop function public.chat_direct_between(uuid, uuid, uuid);
drop trigger chat_messages_system_guard on public.chat_messages;
drop function public.chat_system_guard();
-- System messages go (their conversations stay, as any conversation).
delete from public.chat_messages where kind = 'system';
drop index public.chat_messages_leave_idx;
alter table public.chat_messages
  drop constraint chat_messages_check,
  add constraint chat_messages_check check (deleted_at is not null or char_length(btrim(body)) >= 1 or file_count > 0),
  drop column leave_request_id,
  drop column kind;
