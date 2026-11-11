# Toker — team chat

> **Service card (planned).** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. No code yet: this is the intent and open questions. Source of truth: `docs/decisions.md`, `docs/backlog.md`. Ukrainian twin: `toker-uk.md`.

## 1. Purpose

Team chat next to the work: channels, direct messages, threads. The next big service by plan.

- **State:** ⏳ planned. No detailed plan written yet.

## 2. Intent (from the suite plan)

- Open and closed channels; direct and group messages; reply threads.
- Mentions of a person and a channel, reactions, pinned messages, edit and delete.
- Files and voice messages; history search.
- People statuses, quiet hours, per-channel notification settings, drafts, scheduled send.
- Live chips of pages, tasks and other objects in messages.
- Shared channels with other companies; optionally a bridge to third-party messengers.
- Bots: form answers, task notifications.

## 3. Technical frame (already decided)

- Messages are stored where the rest of the data is: the central database or the team's own database.
- Real-time delivery through the team database's realtime mechanism, no separate servers.
- A closed channel is seen only by its members; checked by the database.
- A shared channel with another company is approved by both workspace owners; each side keeps its history; the platform admin sees no content.
- History retention is set by the workspace owner; chat is part of the "My data" export.

## 4. Expected links

| Service | Link |
|---|---|
| **Rukh** | task from a message; task notifications to a channel |
| **Questa** | survey in a channel; form answers by a bot |
| **Doba** | meeting from a channel (an event with the channel's people); reminders of events in chat; "absent" status from approved time off (Doba's `team_absences`, already live). Doba already notifies through the bell — chat will reuse those events, not duplicate them |
| **Visio** | call from a channel |
| **Wika** | page chips; objects shared between workspaces arrive together with chat |
| **Free / Team** | on Free limited history and no shared channels — draft, open pricing question |

## 5. Open questions

- Cost and limits of realtime in a team database.
- Voice messages: storage and size.
- Notifications when the site is closed.
- How guests see channels.
- Order: chat comes before the file manager.

## Rules shared by any new service

- It is a section of the platform: shared accounts, workspaces, roles, units, guests, storage, search, notifications.
- Data lives in tables with `workspace_id` and access rules in the database; two migrations (central and team) plus the move between databases.
- New tables and access rules need the owner's separate approval before code.
- The service tile already exists on the start page and the landing with a "Soon" badge (`src/lib/services.ts`).
- No third-party product names or logos.
