-- Undo 0078_toker_chat_later.
drop function public.chat_send_due(uuid);
drop function public.chat_cancel_scheduled(uuid);
drop function public.chat_schedule_message(uuid, text, uuid, uuid[], timestamptz);
drop table public.chat_scheduled;
drop function public.check_chat_scheduled_workspace();
drop function public.chat_search(uuid, text, uuid);
