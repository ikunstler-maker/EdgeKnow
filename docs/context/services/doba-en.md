# Doba — company calendar and time off

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-22 (phases 1a and 1b). Source of truth: `docs/decisions.md` (2027-01-21, 2027-01-22) and the code. Ukrainian twin: `doba-uk.md`.

## 1. Purpose

The team's shared calendar and time-off management in one place: events and meetings, who is busy when, vacations and absences with approval through the company's units — later synced with personal calendars.

- **State:** 🟢 events (1a) and time off (1b) built; repeats, Rukh due dates and sync planned.
- **URLs:** `/w/<id>/calendar/time-off` (`?tab=mine|inbox|team|settings`) and `/w/<id>/calendar` (`?view=month|week|list`, `?date=YYYY-MM-DD`, `?event=<id>` opens an event).

## 2. What is built

## 2a. Events (phase 1a)

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

## 2b. Time off (phase 1b)

### Policies
- Four starting templates (vacation, sick leave, day off, remote work) with 0 days — the workspace sets its own numbers; more can be added; a policy is switched off, never deleted.
- Per policy: days per year, carry-over limit, working or calendar days, approval needed or not, deputy required or not, kind shown to colleagues or not, "allow going below zero", "don't limit the balance" (used days are counted, the balance never blocks — remote work, sick leave).

### Balances
- A ledger: yearly accrual, carry-over, manual correction with a required reason; rows never change. Balance = the year's rows − approved requests. The year is the calendar year.
- **"Accrue for everyone"** gives the norm and last year's rest (within the limit) only to members who have no accrual of that policy for that year — safe to press again for new people. For the current and the next year.

### Requests
- Kind, dates within one calendar year, half a day (first or second half), deputy, comment.
- Refused when the balance (counting approved **and** still waiting requests) is not enough — unless the policy allows it — and when the person already has a waiting or approved request on those days (two different halves of one day are fine).
- **Who decides:** leads of the person's units and of the units above, the owner, admins and the role right "Manage time off" (HR). The first decision stands; nobody decides on their own. New requests go to the nearest leads; with none above — to the owner, admins and HR.
- A policy without approval makes the request active at once; the lead and the deputy are told.
- **Cancel:** the person — a waiting request, or an approved one before its first day; who decides — any time. The days come back.
- A hint in the request window and in the approval: who of the same unit is already off or has asked for those dates (names and dates only).

### Who sees what
- Requests and balances: the person and who decides for them.
- Colleagues: approved absences only — "absent" or "working remotely", dates, deputy; the policy's name only if the policy shows it.
- Guests and outsiders: nothing.

### Screens
- "Time off" next to "Events": **Mine** (balances, requests), **To approve**, **Team** (the next 90 days), **Settings** (policies, accrual, the balance sheet with manual corrections) for who manages time off.
- Approved absences show in the calendar's month, week and list.
- Notifications: a request to decide on, a decision, "you are the deputy", an absence for information.

## 3. Planned

| What | State | Note |
|---|---|---|
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
| `leave_policies` | time-off policies |
| `leave_balances` | the ledger: accrual, carry-over, correction |
| `leave_requests` | requests with `deputy_id`, status, who decided |
| `notifications.leave_request_id` | link from a notification to a request |

- Nobody writes these tables directly: only functions (`create_calendar_event`, `update_calendar_event`, `invite_to_calendar_event`, `remove_calendar_event_attendee`, `respond_to_calendar_event`, `decide_calendar_event_request`, `cancel_calendar_event`, `set_calendar_settings`).
- Reading: `calendar_events_in` (a period's events in one pass, access worked out once per call — same rows as the table under RLS, compared in `stage53_calendar`), `calendar_event_details`, `calendar_busy` (start and end only).
- Time off is written only by `seed_leave_policies`, `save_leave_policy`, `accrue_leave_year`, `adjust_leave_balance`, `request_leave`, `decide_leave_request`, `cancel_leave_request`; read by `my_leave`, `leave_inbox`, `leave_balance_sheet`, `leave_unit_overlaps`, `team_absences`. Who decides: `leave_can_decide` (leads up the tree via `leave_leads_of`, managers via `leave_manager`).
- Visibility lives in `calendar_event_visible_to`; a change to the rules must update `calendar_events_in` too.
- The tables exist in both the central and the team database (`0043`), move between them (`src/lib/team-db/move.ts`), go into "My data" (own events, answers, time-off requests and ledger rows) and into the workspace backup (all but private events; time off without the comments).
- Planned (3): `calendar_connections` — central database only, closed to the browser.

## 5. Links with other services

| Service | Link |
|---|---|
| **Core** | units (who decides on time off, the overlap hint), notifications (bell), roles (right `manage_leave`) and guests, "My data", backup |
| **Rukh** | planned: task due dates on the calendar |
| **Toker** | planned: meeting from a channel, reminders, "absent" status |
| **Visio** | planned: video meeting from an event in one click (today: any https link) |
| **Spilno** | planned: meetings with a client |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/calendar/page.tsx`, `src/app/w/[wid]/calendar/time-off/page.tsx` |
| Actions | `src/app/calendar-actions.ts`, `src/app/time-off-actions.ts` |
| Components | `src/components/calendar/` (`calendar-screen.tsx`, `event-dialog.tsx`, `calendar-parts.tsx`, `time-off-screen.tsx`) |
| Logic (dates, zones, layout; time-off shapes) | `src/lib/calendar.ts`, `src/lib/time-off.ts` |
| Migrations | `supabase/migrations/20261228100000_calendar_events.sql`, `20261229100000_time_off.sql`; team `0043_calendar_events.sql`, `0044_time_off.sql` |
| Tests | `supabase/tests/stage53_calendar.sql`, `stage54_time_off.sql`; team `team9g_calendar.sql`, `team9h_time_off.sql`; browser: `scripts/e2e/calendar-checks.mjs` (run by the nodes part) |

## 7. Important decisions

- Titles are shown to everyone only for open and "request" events; hidden kinds give others just a "Busy" slot.
- A request to join is a row of the people table, not a table of its own.
- Private events are hidden from admins too and stay out of the workspace backup.
- A time-off balance is never a stored number: it is the ledger of the year minus approved requests; a new request also counts the ones still waiting.
- The yearly accrual is idempotent (one accrual and one carry-over per person, policy and year, enforced by a unique index).
- Nobody decides on their own request; the first decision stands.
- The kind of an absence is personal (it may be about health): colleagues see it only when the policy says so; the request's comment never leaves the people who decide and stays out of the backup.
- Secrets of external calendars (phase 3): encrypted on the server with their own key `CALENDAR_TOKEN_KEY`, central database only, never in the team database, backups, "My data" or logs.
- No third-party product names or logos in the UI or the code.

## 8. Known gaps and open questions

- Events are not in search or chips yet; no repeats; no reminders before an event.
- Time off: no holidays yet (working days are the week's working days); no part-year norm for someone who joins mid-year (use a manual correction); a request can't cross the new year (split it); an absence chip shows on non-working days inside its period too.
- When an organizer's account is deleted the event stays without an organizer (admins can cancel a non-private one).
- Which sync is free and which is PRO — open pricing question.
- The landing still shows the calendar as "Soon" (its card promises sync, which is phase 3).
