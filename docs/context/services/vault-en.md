# Vault — file manager

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2026-11-13 (VAULT-1). Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `vault-uk.md`.

## 1. Purpose

Browse and manage all files of the workspace storage right in the product.

- **State:** ✅ step 1 (VAULT-1): "All files", read-only. Next VAULT-2 (own files and folders), VAULT-3 ("From Vault" insert), VAULT-4 (rest of Google Drive, versions) — `docs/backlog.md`.
- **Storage:** the single workspace storage (Google Drive or database storage); Vault has no tables of its own yet.

## 1a. What works (VAULT-1)

- `/w/<id>/files`: the files the person already sees in the services — Wika page images and audio (`attachments`), Rukh task files (`task_files`), Toker message files (`chat_files`), Bordy, Kadry, Nodo, Sota, Questa files (`object_files`).
- Each table is read with the person's own session (`dataClient`), so the database decides; files of binned pages, tasks and objects, of removed messages, and unfinished uploads (`pending`) are left out.
- List or grid (kept per browser), filter by service and type, search by name or place, sort; images, audio and video previewed in a dialog; PDF and documents open in a new tab through their service's route; "Go there"; download.
- Limits: the newest 400 files per service (`VAULT_LIMIT`), filters run in the browser; wishlist photos and app logos are left out.
- Files: `src/lib/vault.ts`, `src/components/files/vault-browser.tsx`, `src/app/w/[wid]/files/page.tsx`; check — `scripts/e2e/vault-checks.mjs` (part `nodes`).

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
- File versions.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile on the start page is live (`src/lib/services.ts`, path `/files`).
- No third-party product names or logos.
