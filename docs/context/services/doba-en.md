# Doba — company calendar

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `doba-uk.md`.

## 1. Purpose

The team's shared calendar: meetings, time off, plans — synced with personal calendars.

- **State:** ⏳ planned; not planned in detail.

## 2. Intent (owner's request)

- **Event kinds:** open (everyone sees, can ask to join — the organizer approves); with a "request to join" switch; invite-only; private (only invitees see).
- Vacations and absences on the calendar.
- Meetings with a video-call link.
- **Two-way sync** with external calendars of three kinds: the search provider's, ICS/CalDAV, and the office suite's.
- Join requests and approvals happen inside the product.

## 3. Expected links

| Service | Link |
|---|---|
| **Rukh** | task due dates in the calendar |
| **Toker** | meeting from a channel, reminders in chat |
| **Visio** | video meeting from an event in one click |
| **Spilno** | meetings with a client |

## 4. Open questions

- Sync needs sign-in scopes and third-party secrets → separate approval.
- Time zones, recurring events, conflicts in two-way sync.
- Which sync is free and which is PRO.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
