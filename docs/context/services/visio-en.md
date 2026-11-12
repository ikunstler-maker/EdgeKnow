# Visio — video meetings

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `visio-uk.md`.

## 1. Purpose

Own video calls inside the ecosystem — from chat channels, calendar events and tasks.

- **State:** ⏳ planned; after chat.

## 2. Intent

- A call from a chat channel; a meeting from a calendar event in one click.
- Notes and tasks after the meeting, right there.
- Meeting transcription — through Apus AI.

## 3. Expected links

| Service | Link |
|---|---|
| **Toker** | call from a channel; persistent "Sit nearby" voice rooms in Toker's left panel: click to join in the background, see who is there, share the screen in one click without a calendar meeting (Toker stage 6) |
| **Doba** | meeting in the calendar |
| **Rukh** | follow-up tasks |
| **Apus AI** | transcription and summary |

## 4. Open questions

- Technology: probably direct browser-to-browser media through a hosted relay server. First — a cost and licence check.
- These are costs outside the owner's control: Team includes a pack of hours, beyond it — paid.
- Meeting recordings: where to store and who sees them.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
