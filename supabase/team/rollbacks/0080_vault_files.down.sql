-- Undo team migration 0080_vault_files.

drop function public.clean_vault_items();
drop function public.set_vault_file_limit(uuid, integer);
drop function public.vault_set_general(uuid, boolean, text);
drop function public.vault_set_group_role(uuid, uuid, text);
drop function public.vault_set_member_role(uuid, uuid, text);
drop function public.vault_sharing(uuid);
drop function public.vault_list(uuid, uuid, boolean);
drop function public.vault_delete_forever(uuid);
drop function public.vault_restore(uuid);
drop function public.vault_bin_item(uuid);
drop function public.vault_trash(uuid);
drop function public.vault_move(uuid, uuid);
drop function public.vault_rename(uuid, text);
drop function public.vault_editable(uuid);
drop function public.begin_vault_file(uuid, uuid, text, text, bigint);
drop function public.vault_create_folder(uuid, uuid, text);
drop function public.vault_can_add(uuid, uuid);
delete from storage.buckets where id = 'vault-files';
-- The bytes of Vault's files are queued for the daily cleanup, as for any removed file.
insert into public.attachment_tombstones (storage_path, storage_backend, drive_connection_id, drive_file_id)
select i.storage_path, i.storage_backend, i.drive_account_id, i.drive_file_id
from public.vault_items i where i.kind = 'file' and i.storage_backend in ('supabase', 'drive')
on conflict do nothing;
drop table public.vault_uploads;
drop table public.vault_settings;
drop table public.vault_group_access;
drop table public.vault_access;
drop table public.vault_items;
drop function public.vault_role(uuid);
drop function public.vault_role_of(uuid, uuid);
drop function public.vault_chain(uuid);
drop function public.remember_deleted_vault_file();
drop function public.check_vault_workspace();
