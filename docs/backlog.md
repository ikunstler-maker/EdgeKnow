# Backlog (open work, short)

Long-term plan: `docs/roadmap-uk.md`, `docs/suite-plan-uk.md`. Decisions: `docs/decisions.md`.

## Next by plan
- Chat (suite plan, after surveys) → Presentations → Files manager (roadmap stage 2b).
- Boards Д2: realtime co-editing (postponed by the owner).
- Organization level, shared objects between workspaces (later).

## New directions (2026-11-05, roadmap stage 2c) — each needs its own plan + OK
- Wiki: drafts by default + Publish (RLS change → approval); Share button (copy link, export with format list).
- Tables: user scripts (sandboxed). AI: transcription, dictation, node automations, local LLM / MCP models.
- Service «Персональна сторінка»: company landing builder (Free blocks, Team custom code), custom-code corporate pages (Business), block business cards (company + profile, Free).
- Service «Корпоративні додатки»: owner's ready apps (first: financial monitoring / FinPulse, Team, org admins only) + companies' own embedded apps.
- Shown on `/about` and the start page as «Скоро» (done 2026-11-05).

## Requested by the owner (2026-11-04), not planned in detail yet
- **Corporate calendar (new service).** Events: open (anyone sees, can ask to join → organizer approves), "request to join" switch, invite-only, private (only invitees see). Vacations / time off on the calendar. Meetings with a Google Meet or Zoom link. Two-way sync: Google Calendar, Apple Calendar (ICS/CalDAV), Microsoft (Outlook/Graph). Join requests and approvals go through EdgeKnow. Links: tasks, chat. Big; plan separately (sign-in scopes and secrets → approval).
- **Video meetings (later, after Chat).** Own alternative to Meet/Zoom inside the ecosystem: from chat channels, synced with the calendar and tasks. Plan separately (likely WebRTC with a hosted SFU; cost/licence check first).

## Tasks: templates (owner, 2026-12-16) — DONE (package 3; project + personal templates)
- Custom fields already exist per project (`task_fields`). Add task templates: field values + description skeleton, "Save as template", pick a template when creating a task, default template per project.

## Next packages (owner, 2026-12-18) — order: 7 → 8 → 9 → 6 → 3 → 4
- **7. Tasks:** DONE (review type, rules). Next with 11: 4th column type «Перевіряють» (review); project notification rules (event: column type / specific column / assigned / due changed / comment → recipients: person, group, assignee, reporter, owner). Approved (DB).
- **8. Notifications:** DONE in-app + browser while open. Left: push when the site is closed (VAPID key in Vercel). Was: in-app centre (mentions, changes, rules), browser push (needs a push key in Vercel, set by the owner), per-person settings (events, services, quiet hours). Approved (DB).
- **9. Mascot «Декапентапус» (Apus):** DONE. Was: 15-legged octopus replaces the fish; menu (notifications, feedback/bugs, AI helper later), draggable anywhere (per device), notifications beside it (side chosen), sounds (library or own short file).
- **10. Private tasks:** DONE. Was: approved (DB/RLS). Private by default for author + assignee/co-assignees/responsible; «Publish» opens to the project; admins see id + people only; workspace switch «admins see private contents» (off by default).
- **11. Boards per team:** DONE (PR after #94). Later: open a snapshot card as a read-only page (now the card shows the snapshot). Spec: one task on many boards, own column per board (placements); board access per group (bind or grant); cross-board rules X@A → Y@B, any chain, only manual moves trigger; freezing columns → frozen viewers see a snapshot (no new comments/history/files/notifications) until the task returns; project switch «only admins move frozen tasks». Old note: several boards per project, each owned by a group; move a task to another team's board; rule action «when it enters column X of board 1 → appears in column Y of board 2». PR together with 10.
- **CRM (service 15):** shown as «Soon» (done); plan separately.
- **6. Analytics:** DONE (gating to the Team plan comes with payments). Was: per period/person: created, done, passed through, files, comments, text written; manager metrics (lead/cycle time, overdue, created vs done, stuck, load, reopened) on Team; workspace-wide (wiki, surveys, boards/maps/tables, active people). Guests counted; kept after leaving; deleted account → ID only. Needs approval for DB functions.

## Rename EdgeKnow → Synkvela (owner, 2026-12-22) — plan separately
- UI texts (both languages), page titles, landing, emails, help, docs; logo/favicon; domain and auth redirect URLs (Vercel + Supabase settings by the owner); keep old links working (redirects).
- Service logos replace the numbered squircles on the start page (owner provides or we draw).

## Pricing (plan: `docs/pricing-uk.md`, roadmap stage 4)
- Approved: Team 6/5 $, Business 12/10 $ from 15 editors, rate 45 $/h, target MRR ≈ 3 650 $.
- Open (decide after the current roadmap is done): Free limits per service; which cross-service links are PRO.
- Device limit: 2 devices per email on all tiers and all roles (readers included), region check, paid extra device (~1 $/mo). Sign-in + personal data → owner's separate approval before coding.
- Before payments: verify official prices (Vercel, Supabase, GitHub, Claude, payment provider), taxes with an accountant, actual Actions minutes over 2–3 months.
- Implementation (later, stage 4): per-workspace feature flags + PRO badge component (greyed, explains, links to pricing); wiki export dialog with all formats (PDF/MD free; JSON/CSV/DOCX/HTML PRO).

## Known gaps / follow-ups
- Tables: formula engine lacks array literals `{1,2}`, spill (FILTER/SORT/UNIQUE/TRANSPOSE), ROW/COLUMN(ref), LET/LAMBDA (121/126 match Excel).
- Turnstile: confirm the check shows on open forms once both Vercel keys are set.
- Open registration is a switch in the platform panel (turns on "own database first").
