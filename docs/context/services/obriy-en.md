# Obriy — company apps

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-02-02. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `obriy-uk.md`.

## 1. Purpose

The company apps section: a gallery of the company's outside apps and services, later also ready-made apps from the product owner (the first: financial monitoring).

- **State:** 🟡 partly. Step O-1 (the gallery) is done. Next: O-2, financial monitoring.

## 2. What is built (O-1)

- **Gallery** `/w/<id>/apps`: rectangular tiles (2 per row on desktop and tablet, 1 on phones) with a logo, name, category and description; a category filter.
- A tile opens the app **in a new tab** (`rel="noopener noreferrer"`). No embedding in the platform (the site's policy and most services forbid it).
- **Adding:** paste a link (`https://` or `http://` only) → name, description and logo are read from the site by the same guarded reader as the wiki's link cards (`src/lib/link-preview.ts`; https only). Everything is editable by hand.
- **Logo:** a picture address from the site (https only) or an uploaded picture — PNG/JPEG/GIF/WebP, 2 MB at most, type checked by its first bytes, kept in the workspace's storage (`object_files`).
- **Rights:** only the workspace's owner and admins add, change, share and delete apps. Everyone else at most views, even when given "editor" or "owner". By default the whole company sees an app (no guests); access can be narrowed to people and units.
- Collections in the left panel, the bin (admins), backups, "My data", moving between databases — as for other objects.
- **App page** `/w/<id>/apps/<id>`: details and an "Open ↗" button; admins also get the form, access and the bin.

## 3. Data

- No new tables: a service object in `service_objects` with `service = 'apps'`, `kind = 'app'`, `title` = name, `data` = `{ url, logo?, logoFile?, category?, description? }`.
- Database checks: `app_data_ok(data)` (http/https address without spaces, https logo or a file id, category ≤ 60, description ≤ 500); `service_object_role_of` caps everyone except the owner and admins at "viewer"; `register_object_file` takes app logos up to 2 MB.
- Migrations: `supabase/migrations/20270106100000_apps.sql`, `supabase/team/migrations/0052_apps.sql` (+ rollbacks and tests `stage62_apps`, `team9p_apps`, `upgrade/apps_rollback`).

## 4. Key files

| What | Where |
|---|---|
| Gallery, app page | `src/app/w/[wid]/apps/` |
| Actions (create, save, bin, access, read the link) | `src/app/app-actions.ts` |
| Tile, logo, form | `src/components/apps/` |
| App data and address checks | `src/lib/apps.ts` |
| Logo upload and display | `src/app/api/apps/logo/` |

## 5. Links

| Service | Link |
|---|---|
| **Core** | access, roles, units, collections, storage |
| **Showy** | corporate pages with code — draw the line |
| **Sota** | ready-made apps' data may rest on tables |
| **Apus AI** | automations may call apps |

## 6. Next and open questions

- **O-2: financial monitoring** inside the platform: data in the workspace database, admins only (for now "organization admin" = workspace admin), Team and above. New tables and access need separate approval.
- Search across apps (together with search across presentations).
- Showing an app inside the platform — only if needed (site policy change → approval).
- An app catalogue and review of others' apps — later.
