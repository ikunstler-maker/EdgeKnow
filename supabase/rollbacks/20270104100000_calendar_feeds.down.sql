-- Undo 20270104100000_calendar_feeds.
drop function public.calendar_feed(uuid, text);
drop function public.drop_calendar_feed(uuid);
drop function public.set_calendar_feed(uuid, text);
drop function public.my_calendar_feed(uuid);
drop table public.calendar_feeds;
