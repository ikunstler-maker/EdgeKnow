# Doba — company calendar and time off

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-21 (phase 1a). Source of truth: `docs/decisions.md` (2027-01-21) and the code. Ukrainian twin: `doba-uk.md`.

## 1. Purpose

The team's shared calendar and time-off management in one place: events and meetings, who is busy when, vacations and absences with approval through the company's units — later synced with personal calendars.

- **State:** 🟡 phase 1a (events) built; time off (1b) approved and next; repeats, Rukh due dates and sync planned.
- **URL:** `/w/<id>/calendar` (`?view=month|week|list`, `?date=YYYY-MM-DD`, `?event=<id>` opens an event).

## 2. What is built (phase 1a: events)

### Events
- Title, description, place, video-meeting link (https only), start and end, "all day", time zone, kind, organizer, people.
- **Four kinds:**
  - **open** — every member sees it and joins on their own;
  - **request to join** — every member sees it; joining needs the organizer's decision;
  - **invite only** — only the invited, the owner and admins see it;
  - **private** — only the invited see it (admins don't).
- For the two hidden kinds everyone else sees no title at all — only an anonymous **"Busy"** slot (start and end) when they look at a person's availability or plan a meeting.
- Answers: "going / maybe / not going"; a request to join can be taken back; a declined request can't be sent again (the organizer may invite the person).
- The organizer changes the event and its people; a new time is told to the people.
- **Cancel** keeps the event for 30 days (the organizer, or an admin for a non-private one, can restore it); then it is deleted for good.

### Screens
- **Month** (on a phone: dots, a tap opens the day), **Week** (7 days; 3 on a tablet; 1 on a phone — never a sideways scroll), **List** (the next 60 days, plus the organizer's cancelled events).
- A click on the grid starts an event at that half hour; non-working days are shaded.
- **Availability:** pick colleagues to overlay their busy time; the event form warns who of the invited is already busy.
- Times are kept in UTC and shown in the viewer's own zone; the event keeps the organizer's zone (shown as a note when it differs); a whole-day event has no zone.
- **Settings** (owner and admins): working days of the week and the workspace's time zone.

### Notifications
- Invitation, request to join (to the organizer), answer to a request, time change or cancellation. Each can be muted in the bell's settings. A notification keeps only the event's id: the title shows while the person may see the event.

### Access
- Guests: only events they are personally invited to; they create none and see nobody's busy time.
- Events are created by any member except a guest.
- The platform admin sees nothing of it.

## 3. Planned

| What | State | Note |
|---|---|---|
| **1b Time off** | approved, next | policies (kind, days per year, carry-over, working or calendar days, approval and deputy required or not, kind shown to colleagues or not); balances as a ledger; requests with a deputy; one-step approval by the lead of the person's unit, then up the tree, then owner/admins/HR (first decision wins; nobody approves their own); manual yearly accrual; cancelling an approved request (author before its start; lead, admin or HR any time) returns the days; a policy without approval makes the request active at once and informs the lead and the deputy; a hint when someone of the same unit is already off on those dates; colleagues see only "absent" or "remote", dates and deputy |
| Role right "Manage time off" | approved with 1b | for HR |
| Repeats | phase 2 | column `recurrence` exists and is always empty for now |
| Rukh due dates on the calendar | phase 2 | a read function by the task visibility rules, no new table |
| Automatic accrual, holidays, inviting a unit, search and chips | phase 2 | |
| External calendars (two-way sync, feeds) | phase 3 | separate plan and approval; neutral names only |

## 4. Data

| Table | Holds |
|---|---|
| `calendar_events` | events (cancelled ones keep `deleted_at` for 30 days) |
| `calendar_event_attendees` | a person of an event and their state: invited, requested, accepted, tentative, declined, rejected |
| `calendar_settings` | one row per workspace: working days, time zone |
| `notifications.event_id` | link from a notification to an event |

- Nobody writes these tables directly: only functions (`create_calendar_event`, `update_calendar_event`, `invite_to_calendar_event`, `remove_calendar_event_attendee`, `respond_to_calendar_event`, `decide_calendar_event_request`, `cancel_calendar_event`, `set_calendar_settings`).
- Reading: `calendar_events_in` (a period's events in one pass, access worked out once per call — same rows as the table under RLS, compared in `stage53_calendar`), `calendar_event_details`, `calendar_busy` (start and end only).
- Visibility lives in `calendar_event_visible_to`; a change to the rules must update `calendar_events_in` too.
- The tables exist in both the central and the team database (`0043`), move between them (`src/lib/team-db/move.ts`), go into "My data" (own events and answers) and into the workspace backup (all but private events).
- Planned (1b): `leave_policies`, `leave_balances`, `leave_requests`. Planned (3): `calendar_connections` — central database only, closed to the browser.

## 5. Links with other services

| Service | Link |
|---|---|
| **Core** | units (approval route in 1b), notifications (bell), roles and guests, "My data", backup |
| **Rukh** | planned: task due dates on the calendar |
| **Toker** | planned: meeting from a channel, reminders, "absent" status |
| **Visio** | planned: video meeting from an event in one click (today: any https link) |
| **Spilno** | planned: meetings with a client |

## 6. Key files

| What | Where |
|---|---|
| Screen | `src/app/w/[wid]/calendar/page.tsx` |
| Actions | `src/app/calendar-actions.ts` |
| Components | `src/components/calendar/` (`calendar-screen.tsx`, `event-dialog.tsx`, `calendar-parts.tsx`) |
| Logic (dates, zones, layout) | `src/lib/calendar.ts` |
| Migrations | `supabase/migrations/20261228100000_calendar_events.sql`, `supabase/team/migrations/0043_calendar_events.sql` |
| Tests | `supabase/tests/stage53_calendar.sql`, `supabase/team/tests/team9g_calendar.sql`, `scripts/e2e/nodes.mjs` (calendar part) |

## 7. Important decisions

- Titles are shown to everyone only for open and "request" events; hidden kinds give others just a "Busy" slot.
- A request to join is a row of the people table, not a table of its own.
- Private events are hidden from admins too and stay out of the workspace backup.
- Secrets of external calendars (phase 3): encrypted on the server with their own key `CALENDAR_TOKEN_KEY`, central database only, never in the team database, backups, "My data" or logs.
- No third-party product names or logos in the UI or the code.

## 8. Known gaps and open questions

- Events are not in search or chips yet; no repeats; no reminders before an event.
- When an organizer's account is deleted the event stays without an organizer (admins can cancel a non-private one).
- Which sync is free and which is PRO — open pricing question.
- The landing still shows the calendar as "Soon" until time off is live.
