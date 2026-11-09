-- Undo 20261225100000_page_acks.
drop function public.page_ack_stats(uuid, integer);
drop function public.ack_page(uuid);
drop function public.page_ack_edition(uuid, text);
drop function public.disable_page_ack(uuid);
drop function public.set_page_ack(uuid, text, uuid[]);
drop function public.publish_page_ack_revision(uuid);
drop table public.page_acks;
drop table public.page_ack_revisions;
drop function public.can_manage_page_ack(uuid);
drop function public.guard_page_ack();
drop trigger pages_frozen on public.pages;
drop function public.guard_frozen_page();
drop function public.page_ack_hash(text, jsonb);
alter table public.pages
  drop constraint pages_ack_state,
  drop column ack_groups,
  drop column ack_editing,
  drop column ack_revision,
  drop column ack_label;
