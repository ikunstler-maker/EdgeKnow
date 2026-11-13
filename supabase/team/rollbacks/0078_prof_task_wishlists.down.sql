-- Undo the task-wishlist links.
drop function public.delete_task_wishlist_link(uuid);
drop function public.add_task_wishlist_link(uuid, uuid);
drop table public.task_wishlist_links;
drop function public.check_task_wishlist_link();
