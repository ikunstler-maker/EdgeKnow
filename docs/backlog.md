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

## Tasks: templates (owner, 2026-12-16) — needs plan + OK (migration)
- Custom fields already exist per project (`task_fields`). Add task templates: field values + description skeleton, "Save as template", pick a template when creating a task, default template per project.

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
