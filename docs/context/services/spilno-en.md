# Spilno — CRM

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `spilno-uk.md`.

## 1. Purpose

Clients, deals and the sales funnel next to tasks and documents.

- **State:** ⏳ planned; shown as "Soon", no separate plan yet.

## 2. Intent (from the landing)

- Clients, contacts and communication history.
- Deals and the sales funnel on a board.
- Tasks, documents and meetings with a client in one place.

## 3. Expected links

| Service | Link |
|---|---|
| **Rukh** | tasks per client and deal; the funnel board may reuse task-board mechanics |
| **Wika** | client documents |
| **Doba, Visio** | meetings with a client |
| **Questa** | request form → new contact |
| **Guests** | a client as a workspace guest |

## 4. Open questions

- Build the funnel on Rukh boards or separately.
- Clients' personal data: storage, export, deletion.
- Contact import.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
