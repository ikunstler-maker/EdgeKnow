-- VAULT-2b in a team's own database (as supabase/migrations/20270212150000_vault_drive_shares.sql).
-- Rollback: supabase/team/rollbacks/0085_vault_drive_shares.down.sql

-- VAULT-2b (owner, 2026-11-13: "Так, погоджую VAULT-2б"): Vault's access mirrored on the
-- team's Google Drive. A Vault file kept on the Drive is shared there with every member
-- (never a guest or a former member) who has a role on it in Vault: viewers read, editors
-- write; taken away when the role goes. The server keeps this table in step with the
-- Drive (no notification emails); it is for the server only. Folders don't exist on the
-- Drive, so a folder's access reaches each file in it.

create table public.vault_drive_shares (
  item_id        uuid not null references public.vault_items (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  email          text not null check (char_length(email) between 3 and 320),
  role           text not null check (role in ('reader', 'writer')),
  -- The Drive file shared (a new version is another file: shared anew, the old one taken back).
  drive_file_id  text not null,
  -- The Drive's permission (null: not shared — see error).
  permission_id  text,
  -- Why the Drive refused (e.g. the address has no Google account); tried again daily.
  error          text check (char_length(error) <= 200),
  updated_at     timestamptz not null default now(),
  primary key (item_id, email)
);
create index vault_drive_shares_ws_idx on public.vault_drive_shares (workspace_id);
alter table public.vault_drive_shares enable row level security;
revoke all on public.vault_drive_shares from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.vault_drive_shares to service_role;
  end if;
end $$;

-- Who should have each Drive-kept file of the workspace, and how (server only).
create function public.vault_drive_wanted(ws uuid)
returns table (item_id uuid, drive_account_id uuid, drive_file_id text, email text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.drive_account_id, i.drive_file_id, lower(p.email),
         case when r.role in ('owner', 'editor') then 'writer' else 'reader' end
  from public.vault_items i
  join public.workspace_members m on m.workspace_id = i.workspace_id and m.status = 'active' and m.role <> 'guest'
  join public.profiles p on p.id = m.user_id
  cross join lateral (select public.vault_role_of(i.id, m.user_id) as role) r
  where i.workspace_id = ws and i.kind = 'file' and i.storage_backend = 'drive' and i.deleted_at is null
    and i.version_of is null and i.drive_file_id is not null and r.role is not null and p.email is not null;
$$;
revoke execute on function public.vault_drive_wanted(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.vault_drive_wanted(uuid) to service_role;
  end if;
end $$;

-- For those who edit a file: the people it could not be opened to on the Drive.
create function public.vault_drive_failures(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.vault_editable(target) then
    return public.ws_error('forbidden');
  end if;
  return jsonb_build_object('ok', true, 'emails', coalesce((
    select jsonb_agg(s.email order by s.email) from public.vault_drive_shares s
    where s.item_id = target and s.permission_id is null and s.error is not null), '[]'::jsonb));
end;
$$;
revoke execute on function public.vault_drive_failures(uuid) from public, anon;
grant execute on function public.vault_drive_failures(uuid) to authenticated;
