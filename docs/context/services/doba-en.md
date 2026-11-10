# Doba — company calendar and time off

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-31 (phases 1a, 1b, 2a, 2b, 2c, 2d, 3a, 3b). Source of truth: `docs/decisions.md` (2027-01-21, 2027-01-22, 2027-01-24, 2027-01-25, 2027-01-27, 2027-01-28, 2027-01-30, 2027-01-31, 2027-02-01) and the code. Ukrainian twin: `doba-uk.md`.

## 1. Purpose

The team's shared calendar and time-off management in one place: events and meetings, who is busy when, vacations and absences with approval through the company's units — later synced with personal calendars.

- **State:** 🟢 events (1a), time off (1b), repeats and reminders (2a) built; Rukh due dates, holidays and sync planned.
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

### Repeats and reminders (phase 2a)
- A series is one event with a rule: daily, weekly on chosen days, monthly, yearly, every N; ends never, on a date, or after N times (turned into the last day when saved).
- Its days are worked out when read, in the event's own time zone (10:00 stays 10:00 across a clock change); months without the day (the 31st, 29 February) are skipped.
- Changing or cancelling asks **what**: "only this event" (that day gets its own time and texts), "this and the following" (the old series ends the day before, a new one with the same people and answers starts there; "N times" passes on what is left), "all" (a new time or rule resets the days changed one by one).
- An answer ("going / not going") is for the whole series.
- **Free/busy** and the calendar read days through one function: a cancelled day is nowhere and frees the time, a moved day is busy where it went.
- **Reminder** per event (set by the organizer): 10 minutes, an hour or a day before. It reaches the bell while the site is open — there is no scheduler; a due reminder is made when the bell asks for news, once per event and start. Anyone can mute the kind.

### Links with the rest of the platform (phase 2b)
- **Rukh due dates:** a switch "no tasks / my tasks / all I can see" (default mine; kept on the device). Open tasks and those done within 14 days, on the due day only; read-only here, a click opens the task. At most three cards a day, then a "+N" counter that opens them all; the month shows one "tasks: N" row.
- The calendar reads every project through `project_tasks` — the board's own one-pass rule — so it shows exactly what the person reads in Rukh. Another person's private task is not there at all.
- **A unit invited to an event:** everyone in it and in the units under it (not guests, not the leads above) — once, when added. The event remembers its units; the organizer's "Refresh" invites who joined since. Who said "not going" is not invited again; who left a unit stays in the event.
- **Search** finds events by title, place and description — only those the person sees, coming ones first. **Event chip** in the wiki (from "@"): title and time read with the reader's access; "No access" without the name otherwise.

### Screens
- **Month** (on a phone: dots, a tap opens the day), **Week** (7 days; 3 on a tablet; 1 on a phone — never a sideways scroll), **List** (the next 60 days, plus the organizer's cancelled events).
- **The grid answers the pointer (phase 2d):** a switch says what it makes — an event or a time-off request. The half hour (week) or the cell (month, "all day" row) under the pointer is highlighted. A click makes an hour from that slot; a drag down the hours picks a time that sticks to 15 minutes (also across days); a drag along the "all day" row or across month cells picks whole days. In the "absence" mode the picked days open a time-off request. Dragging is for a mouse or a pen; touch keeps its taps and scrolling. Non-working days are shaded.
- One's own absence, and one's own request that still waits (shown to its person only, dashed), open from the calendar with "Withdraw".
- **Availability:** pick colleagues to overlay their busy time; the event form warns who of the invited is already busy.
- Times are kept in UTC and shown in the viewer's own zone; the event keeps the organizer's zone (shown as a note when it differs); a whole-day event has no zone.
- **Settings** (owner and admins): working days of the week and the workspace's time zone.

### In one's own calendar (phase 3a)
- "🔗 Show in my calendar" gives each person (a guest too) a secret address in the common calendar-subscription format. Any calendar app reads it without a session.
- It holds the events the person organizes or takes part in (not the declined ones): title, time, place, meeting link — **no description** — and the person's **own approved time off**. From 30 days back to a year ahead; series are spread out day by day.
- Only the hash of the secret is kept, so the address is shown once. "New address" kills the old one at once; "Turn off" deletes it. A person removed from the workspace gets nothing; every failure is the same 404.

### Busy time from one's own outside calendar (phase 3b)
- In the same window a member (not a guest) pastes the subscription address of their own calendar (https; `webcal://` is the same).
- Only starts and ends of the next 90 days are taken — titles, places and people are never read out of the file. Cancelled and "free" events don't count; a whole day counts only when marked "busy". Series are spread out (changed and cancelled days, zones); overlapping slots become one.
- Colleagues get it as plain anonymous "Busy" (availability, the overlap hint) with nothing to tell where it came from; only the owner sees "Busy (outside calendar)" in their own week.
- Stale-while-revalidate: the calendar opens with what is known; an address not read for an hour is read again after the response; once a day all of them; "Refresh now" by hand (once a minute at most). Each refresh replaces the person's slots; past ones are not kept.
- "Disconnect" (and leaving the workspace) removes the address and every slot at once.

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

### Holidays, accrual by itself, start dates (phase 2c)
- **Holidays:** a list per year kept by who manages time off, with "copy from last year". Not taken from the balance by working-day policies (calendar-day policies take every day); shaded and named on the calendar. A holiday added after a request was made doesn't recount it — who decides sees a hint.
- **How the norm arrives** (per policy): by the button, every year on 1 January, or every month on the 1st. The daily cleanup runs it in every database; only the difference between what is due and what was given is written, so nothing comes twice and a missed day is made up. Monthly parts are a running total rounded to half a day, so the year adds up to the norm exactly.
- **Start date** per person (set by admins and HR; the person sees their own; leads don't see others'): who started within a year gets that year's norm in proportion to the months from the month of the start to December (that month counts whole), rounded up to half a day.

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
| Event chip in task descriptions | with "smart chips everywhere" | the task description has no chips yet |
| Dragging on touch screens; moving or resizing an event by dragging | later | |
| Reminders when the site is closed | with push notifications | |
| Sign-in with a provider (busy time from the primary calendar; Doba events into the app's own "Doba" calendar) | phase 3c, on hold | architecture decided 2027-02-01, code waits for the owner's OK; strictly minimal access; PRO mark; the provider named on its sign-in button only |

## 4. Data

| Table | Holds |
|---|---|
| `calendar_events` | events (cancelled ones keep `deleted_at` for 30 days); the repeat rule (`repeat_freq`, `repeat_interval`, `repeat_days`, `repeat_until`, `repeat_count`) and `reminder_minutes`; the old text column `recurrence` is unused |
| `calendar_event_exceptions` | one day of a series that is cancelled or has its own time and texts |
| `calendar_event_attendees` | a person of an event and their state: invited, requested, accepted, tentative, declined, rejected |
| `calendar_settings` | one row per workspace: working days, time zone |
| `notifications.event_id`, `event_at` | link from a notification to an event (and, for a reminder, to the start it is about) |
| `leave_policies` | time-off policies (with `accrual`: manual / yearly / monthly) |
| `leave_holidays` | the workspace's holidays |
| `leave_member_settings` | a person's start date |
| `leave_balances` | the ledger: yearly accrual, monthly part (`month`), carry-over, correction |
| `leave_requests` | requests with `deputy_id`, status, who decided |
| `notifications.leave_request_id` | link from a notification to a request |
| `calendar_feeds` | one row per person and workspace: the hash of the feed's secret |
| `calendar_external_busy` | a person's busy slots from their outside calendar: start, end, whole day — nothing else |
| `calendar_connections` (central only) | the outside calendar's address, encrypted; last try, last success, short error code |

- Nobody writes these tables directly: only functions (`create_calendar_event`, `update_calendar_event`, `invite_to_calendar_event`, `remove_calendar_event_attendee`, `respond_to_calendar_event`, `decide_calendar_event_request`, `cancel_calendar_event`, `set_calendar_settings`; for series — `change_calendar_occurrence`, `cancel_calendar_occurrence`, `split_calendar_event`, `end_calendar_series`; reminders — `calendar_remind_me`).
- Phase 2b reads: `calendar_tasks` (Rukh tasks of a period), `search_calendar_events`, `calendar_event_chips`; writes: `invite_unit_to_calendar_event`, `refresh_calendar_event_units` (units kept in `calendar_events.invited_group_ids`). A change to the task visibility rules needs no change here as long as `project_tasks` follows it.
- The days of a rule: `calendar_series` (arithmetic only); the real days of an event: `calendar_event_occurrences` (without cancelled days, with moved ones). **Anything new that reads a period must go through it** — the calendar, free/busy and reminders do.
- Reading: `calendar_events_in` (a period's events in one pass, access worked out once per call — same rows as the table under RLS, compared in `stage53_calendar`), `calendar_event_details`, `calendar_busy` (start and end only).
- Accrual: `leave_norm` (whole or in proportion), `leave_due_by_month` (the running total), `leave_accrue_person` (writes the difference), `run_leave_accruals` (server only, called by `src/app/api/cron/cleanup-files`). Holidays and start dates: `save_leave_holiday`, `delete_leave_holiday`, `copy_leave_holidays`, `set_leave_start_date`.
- Time off is written only by `seed_leave_policies`, `save_leave_policy`, `accrue_leave_year`, `adjust_leave_balance`, `request_leave`, `decide_leave_request`, `cancel_leave_request`; read by `my_leave`, `leave_inbox`, `leave_balance_sheet`, `leave_unit_overlaps`, `team_absences`. Who decides: `leave_can_decide` (leads up the tree via `leave_leads_of`, managers via `leave_manager`).
- Visibility lives in `calendar_event_visible_to`; a change to the rules must update `calendar_events_in` too.
- The tables exist in both the central and the team database (`0043`), move between them (`src/lib/team-db/move.ts`), go into "My data" (own events, answers, time-off requests and ledger rows) and into the workspace backup (all but private events; time off without the comments).
- The feed (3a): `calendar_feeds` is closed to everyone; `my_calendar_feed`, `set_calendar_feed`, `drop_calendar_feed` are the person's own; `calendar_feed(ws, hash)` is for the server only (the route uses the secret key of wherever the workspace keeps its data). It moves with the workspace; it is in neither the backup nor "My data".
- Outside busy time (3b): `calendar_connections` is closed to everyone and exists only centrally — the server reads and writes it with the secret key (`src/lib/calendar-external.ts`). `calendar_external_busy`: a person selects only their own rows; `set_calendar_external_busy(ws, person, slots)` is for the server only and replaces everything; `calendar_busy` adds these rows for active members. Triggers on `workspace_members` remove both when a person is removed. The slots move with the workspace and are in "My data"; neither table is in the backup.

## 5. Links with other services

| Service | Link |
|---|---|
| **Core** | units (who decides on time off, the overlap hint), notifications (bell), roles (right `manage_leave`) and guests, "My data", backup |
| **Rukh** | task due dates on the calendar (`calendar_tasks`, through `project_tasks`) |
| **Toker** | planned: meeting from a channel, reminders, "absent" status |
| **Visio** | planned: video meeting from an event in one click (today: any https link) |
| **Spilno** | planned: meetings with a client |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/calendar/page.tsx`, `src/app/w/[wid]/calendar/time-off/page.tsx` |
| Actions | `src/app/calendar-actions.ts`, `src/app/time-off-actions.ts` |
| Outside busy time (3b) | `src/lib/calendar-external.ts` (address, download, refresh), `src/lib/calendar-external-parse.ts` (file → slots; `ical.js`), `src/app/calendar-external-actions.ts`; daily run in `src/app/api/cron/cleanup-files` |
| Feed (3a) | `src/app/api/calendar-feed/[ws]/[token]/route.ts` (open in `src/lib/supabase/proxy.ts`), `src/lib/calendar-feed.ts` (the file's text) |
| Components | `src/components/calendar/` (`calendar-screen.tsx`, `event-dialog.tsx`, `calendar-parts.tsx`, `time-off-screen.tsx`, `use-day-drag.ts`); the wiki chip — `src/components/editor/event-chip.tsx` |
| Logic (dates, zones, layout; time-off shapes) | `src/lib/calendar.ts`, `src/lib/time-off.ts` |
| Migrations | `supabase/migrations/20261228100000_calendar_events.sql`, `20261229100000_time_off.sql`; team `0043_calendar_events.sql`, `0044_time_off.sql`, `0045_calendar_repeats.sql`, `0046_calendar_links.sql`, `0048_leave_holidays.sql`, `0050_calendar_feeds.sql`, `0051_calendar_external.sql` (central `20270105100000_calendar_external.sql`, `20270104100000_calendar_feeds.sql`, `20270102100000_leave_holidays.sql`, `20261230100000_calendar_repeats.sql`, `20261231100000_calendar_links.sql`) |
| Tests | `supabase/tests/stage53_calendar.sql`, `stage54_time_off.sql`, `stage55_calendar_repeats.sql`, `stage56_calendar_links.sql`, `stage58_leave_holidays.sql`, `stage60_calendar_feeds.sql`, `stage61_calendar_external.sql`; team `team9g_calendar.sql`, `team9h_time_off.sql`, `team9i_calendar_repeats.sql`, `team9j_calendar_links.sql`, `team9l_leave_holidays.sql`, `team9n_calendar_feeds.sql`, `team9o_calendar_external.sql`; file parsing: `scripts/test-calendar-external.mjs`; browser: `scripts/e2e/calendar-checks.mjs` (run by the nodes part) |

## 7. Important decisions

- Titles are shown to everyone only for open and "request" events; hidden kinds give others just a "Busy" slot.
- A request to join is a row of the people table, not a table of its own.
- Private events are hidden from admins too and stay out of the workspace backup.
- A time-off balance is never a stored number: it is the ledger of the year minus approved requests; a new request also counts the ones still waiting.
- The yearly accrual is idempotent (one accrual and one carry-over per person, policy and year, enforced by a unique index).
- Nobody decides on their own request; the first decision stands.
- The kind of an absence is personal (it may be about health): colleagues see it only when the policy says so; the request's comment never leaves the people who decide and stays out of the backup.
- A feed's address is a secret shown once; the database knows only its hash, and what the feed holds is worked out by one server-only function.
- From an outside calendar only starts and ends are ever stored; to colleagues they are indistinguishable from Doba events.
- Secrets of external calendars (phases 3b, 3c): encrypted on the server with their own key `CALENDAR_TOKEN_KEY`, central database only, never in the team database, backups, "My data" or logs.
- No third-party product names or logos in the UI or the code.

## 8. Known gaps and open questions

- No event chip in task descriptions; tasks can't be moved to another day from the calendar.
- Series: no answer for a single day; no rule like "the last Friday of the month"; a notification about a changed day doesn't say which day; reminders don't come while the site is closed.
- Time off: a request can't cross the new year (split it); holidays are entered by hand (no ready sets by country); a holiday added later doesn't recount requests already made; accrual by itself runs once a day.
- When an organizer's account is deleted the event stays without an organizer (admins can cancel a non-private one).
- Outside busy time: one address per person; shown to its owner in the week only; a calendar that needs a sign-in can't be read (that is phase 3c); tests replace the network with files (`CALENDAR_FAKE_DIR`, never on the real site).
- The feed is refreshed by the outside calendar itself (often every few hours); it covers a year ahead; its time-off entries carry the policy's name.
- The landing still shows the calendar as "Soon" (its card promises sync, which is phase 3).
