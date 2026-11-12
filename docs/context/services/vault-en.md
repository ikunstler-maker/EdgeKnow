# Vault — file manager

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `vault-uk.md`.

## 1. Purpose

Browse and manage all files of the workspace storage right in the product.

- **State:** ⏳ planned (roadmap stage 2b).
- **Already there without the service:** the single workspace storage (Google Drive or database storage) for wiki images, task files, board and slide images, survey files.

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
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
