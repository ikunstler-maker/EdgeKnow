-- Undo VAULT-2b (vault_drive_shares).
-- (What was shared on the Drive stays shared there; take it away first if needed.)

drop function public.vault_drive_failures(uuid);
drop function public.vault_drive_wanted(uuid);
drop table public.vault_drive_shares;
