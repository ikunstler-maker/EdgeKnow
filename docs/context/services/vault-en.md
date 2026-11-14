# Vault — file manager

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2026-11-13 (VAULT-7). Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `vault-uk.md`.

## 1. Purpose

Browse and manage all files of the workspace storage right in the product.

- **State:** ✅ VAULT-1 ("All files"), VAULT-2 (own folders and files), VAULT-3 ("From Vault"), VAULT-4 (space), VAULT-6 (versions), VAULT-2b (access on Google Drive), VAULT-7 ("Team Drive" tab) — `docs/backlog.md`.
- **Storage:** the single workspace storage (Google Drive or database storage); files over 4 MB only on the Drive.

## 1a. What works (VAULT-1)

- `/w/<id>/files`: the files the person already sees in the services — Wika page images and audio (`attachments`), Rukh task files (`task_files`), Toker message files (`chat_files`), Bordy, Kadry, Nodo, Sota, Questa files (`object_files`).
- Each table is read with the person's own session (`dataClient`), so the database decides; files of binned pages, tasks and objects, of removed messages, and unfinished uploads (`pending`) are left out.
- List or grid (kept per browser), filter by service and type, search by name or place, sort; images, audio and video previewed in a dialog; PDF and documents open in a new tab through their service's route; "Go there"; download.
- Limits: the newest 400 files per service (`VAULT_LIMIT`), filters run in the browser; wishlist photos and app logos are left out.
- Files: `src/lib/vault.ts`, `src/components/files/vault-browser.tsx`, `src/app/w/[wid]/files/page.tsx`; check — `scripts/e2e/vault-checks.mjs` (part `nodes`).

## 1b. Own folders and files (VAULT-2)

- Tabs of `/w/<id>/files`: "Files" (`?folder=<id>`), "All files" (`?tab=all`), "Bin" (`?tab=bin`); a guest gets only "All files".
- Tables: `vault_items` (one tree of folders and files, 30-day bin via `trashed_with`), `vault_access`, `vault_group_access`, `vault_settings`, `vault_uploads`. Role — `vault_role_of()`: owner; owner of a folder above — editor; general access from above (the top: all members view; `workspace_role` on an item; `inherit = false` — invited only); people's and units' roles (`unit_reaches`). Guests and former members get nothing; admins don't see restricted items.
- Functions: `vault_create_folder`, `begin_vault_file`, `vault_rename`, `vault_move`, `vault_trash`, `vault_restore`, `vault_delete_forever`, `vault_list`, `vault_sharing`, `vault_set_member_role`, `vault_set_group_role`, `vault_set_general`, `set_vault_file_limit`, `clean_vault_items` (server).
- Routes: `POST /api/vault/files` (up to 4 MB), `/api/vault/files/large` (parts to the Drive), `GET /api/vault/files/<id>`. Bucket `vault-files`, path `<ws>/vault/<id>`.
- Code: `src/components/files/vault-drive.tsx`, `vault-share-dialog.tsx`, `vault-move-dialog.tsx`, `vault-limit-panel.tsx`, `src/app/vault-actions.ts`, `src/lib/vault-files.ts`; tests `supabase/tests/stage89_vault_files.sql`, `supabase/team/tests/team9z6_vault_files.sql`, e2e `scripts/e2e/vault-checks.mjs`.

## 1c. "From Vault" in other services (VAULT-3)

- Only the file's id is kept; the card (`VaultFileEmbed`, `src/components/files/vault-file-embed.tsx`) is read with the viewer's access (`vaultFileView`); without it — "File unavailable", no name.
- Wika: block `vaultFile`; task: a task link `…/files?file=<id>` titled "File from Vault", shown as a card; slides and "Design": embed kind `file`; idea board: "File from Vault" written with the link; Toker: a link in a message → a card (`chat-chips`, kind `file`).
- File links: `vaultFileHref()` / `vaultFileIdOf()` (`src/lib/vault-links.ts`); `/w/<id>/files?file=<id>` opens the folder with the file marked.

## 1d. Space and hand-over (VAULT-4)

- "Used" in Vault (`vault_storage_usage`, owner and admins, sizes only) by service; without a Drive — the database's storage of the workspace's limit.
- Every upload counts space the same way (`workspace_storage_used`): all services plus Vault.
- "Hand over" for a former member (`reassign_member_pages`) also hands over their Vault folders and files (never to a guest); `departed_page_owners` returns `files`.
- "My data": the owner's `vault_items`.

## 1e. Versions (VAULT-6)

- `vault_versions` (earlier versions); `vault_items` gains `version`, `content_by`, `version_of` (a hidden upload of a new version). Functions: `begin_vault_version`, `vault_finish_version`, `vault_restore_version`, `vault_delete_version`. Upload routes take `replace=<id>`; `GET /api/vault/files/<id>?version=<id>` serves an earlier version.
- UI: "New version" and "Versions" in a file's menu (`vault-versions-dialog.tsx`).

## 1f. Access on Google Drive (VAULT-2b)

- `src/lib/drive/vault-shares.ts`: `syncVaultDriveShares` compares `vault_drive_wanted` (who should have a file: members with a role, no guests or former members) with `vault_drive_shares` and shares/changes/unshares on the Drive without emails; `syncVaultSharesLater` after a change (via `after()`), `syncAllVaultDriveShares` daily.
- Refusals (an address with no Google account) — `vault_drive_failures` in the Access dialog for editors.

## 1g. Team Drive inside Vault (VAULT-7)

- Tab "Team Drive" (`?tab=google`, `src/components/files/vault-google.tsx`): members (not guests) browse the Drive connected to the workspace (one workspace = one Drive) through `/api/vault/drive` (a folder, paged) and `/api/vault/drive/file` (download; picture/PDF shown; Google documents exported as PDF). Server only (`src/lib/drive/vault-browse.ts`, `browseContext`).
- Owner's switch `vault_settings.drive_browse` (on by default; `set_vault_drive_browse`, owner only). Reading the whole Drive needs `drive_connections.can_browse`: the owner allows it once (`/api/drive/connect?browse=1`, the same Google account; scope `drive.readonly`; no new folders).
- "Add to Vault" (`linkDriveFile`): `begin_vault_link` (user session) + the server points the record at the Drive file → `storage_backend = 'drive_link'`. No copy, no space (`large`), no versions (`check_vault_link_version`), the bin removes only the link (no tombstone); `vault_list` returns `link`. Links aren't shared on the Drive by VAULT-2b. "Add to Vault" asks where (the Move dialog, `VaultMoveDialog` with `title`/`submit`; only folders the person may add to; VAULT-7b).

## 2. Intent

- List and grid views, folders, preview (images, PDF, video, documents).
- Drag-and-drop upload, rename, move, delete to trash, search.
- "Insert" a file into a page, task, board or presentation.
- Shows **where a file is used**.
- For Google Drive: the product's folder — fully; other files — through Google's picker (access to chosen files only). Browsing the whole Drive needs an expensive permission — consider later.

## 3. Expected links

| Service | Link |
|---|---|
| **All services** | files from every service in one place; insert a file into any |
| **Toker** | chat files and voice messages appear in the file manager only for people with access to the channel; a file is checked by its first bytes and served after an access check |
| **Core** | storage, access: a file is seen by whoever sees the object it is attached to |

## 4. Open questions

- Access to a file not attached to any object: needs rules of its own.
- Space accounting and limits by plan; "storage beyond the included" is a paid extra.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile on the start page is live (`src/lib/services.ts`, path `/files`).
- No third-party product names or logos.
