-- Undo the collections migration.
drop function if exists public.set_collection_item(uuid, uuid, boolean);
drop function if exists public.delete_object_collection(uuid);
drop function if exists public.save_object_collection(uuid, uuid, text, text, double precision);
drop function if exists public.can_manage_collections(uuid);
drop table if exists public.object_collection_items;
drop table if exists public.object_collections;
