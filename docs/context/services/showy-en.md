# Showy — personal pages

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `showy-uk.md`.

## 1. Purpose

The public face of the company and its people: landing pages, business cards, corporate pages.

- **State:** ⏳ planned.

## 2. Intent

| What | Plan |
|---|---|
| **Block-built business cards** — for the company and for each profile | Free |
| **Company landing page** from ready blocks, no custom code | Free |
| Landing page with **custom code inside the site** | Team |
| **Corporate pages with custom code** — the company deploys its own services | Business |

The code restriction on Free keeps the section from being used to deploy applications.

The model for business cards is another service of the owner (a block builder).

## 3. Expected links

| Service | Link |
|---|---|
| **Wika** | public knowledge base — a related feature (reading without sign-in) |
| **Questa** | a form on a landing page |
| **Obriy** | corporate pages with code are close to own apps: the line between the services must be drawn |
| **Vault** | page images and files |

## 4. Open questions

- Public pages mean access without sign-in → approval; a separate domain for foreign code so it cannot reach a person's session.
- The company's own domain.
- A "Made with …" mark on Free.
- How a "corporate page with code" differs from an "own app" in Obriy.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
