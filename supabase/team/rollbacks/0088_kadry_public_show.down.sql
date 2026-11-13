-- Undo 0088_kadry_public_show.
drop function public.public_deck(text);
drop function public.set_deck_public_link(uuid, boolean, boolean);
drop table public.deck_public_links;
