-- Undo the objects of the services (their content goes with them).
drop trigger if exists workspace_members_drop_object_access on public.workspace_members;
drop function if exists public.drop_object_access_of_removed_member();
drop function if exists public.set_service_object_group_role(uuid, uuid, text);
drop function if exists public.set_service_object_member_role(uuid, uuid, text);
drop function if exists public.set_service_object_workspace_role(uuid, text);
drop function if exists public.delete_service_object_forever(uuid);
drop function if exists public.trash_service_object(uuid, boolean);
drop function if exists public.save_service_object(uuid, text, jsonb, integer);
drop function if exists public.create_service_object(uuid, text, text, text, jsonb);
drop function if exists public.service_object_text(jsonb);
drop table if exists public.service_object_group_access;
drop table if exists public.service_object_access;
drop table if exists public.service_objects;
drop function if exists public.service_object_role(uuid);
drop function if exists public.service_object_role_of(uuid, uuid);
drop function if exists public.check_service_object_workspace();
