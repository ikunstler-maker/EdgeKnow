# Backlog (open work, short)

Long-term plan: `docs/roadmap-uk.md`, `docs/suite-plan-uk.md`. Decisions: `docs/decisions.md`.

## Now (owner, 2027-01-01) — 4 PRs, in order
- PR 1 Tasks: field hints + drag order, create-task dialog, drag columns — DONE (#107).
- PR 2 Instant create (tasks, wiki pages): optimistic UI, background write, "not saved" notice + retry. — DONE (#108).
- PR 3 Left panel shows only the current section (tasks: projects/boards/tasks; wiki: pages; tables: tables…); fix the old fish name near Apus. — DONE (#109).
- PR 4 Collections in the left panel (tables, boards, maps, slides, surveys, sites, apps): shared per workspace, editors+admins create; one object in many collections (link table, no copies). DB/RLS → approved 2027-01-01. — DONE (#110).

## Next (owner, 2027-01-05)
- PR А: add a task field right in the task / new-task window — DONE (#111).
- PR Б-1: unit tree — DONE (#112).
- PR Б-2: custom roles — DONE (#113).
- PR Б-3: access follows the tree — DONE (#114).
- Follow-up: hide New page when the role forbids pages; backup carries roles, tree, collections — DONE (#115).
- PR Б (stages, each its own PR, RLS → approval per stage): company hierarchy (groups → tree of units), custom named roles with workspace rights + content level, access by structure (up: higher units see; down: a unit's sub-units see), current admin/member become built-in roles. Owner agreed on all 4 questions.

## Canvas engine: Presentations, then Bordy «Дизайн» (owner, 2027-01-09; decision 2027-01-09)
- П-1 deck editor — DONE (#116).
- П-2 look — DONE (#117).
- П-3а show (sizes, player, transitions, presenter, PDF) + П-3б embeds — DONE (#118).
- Later (owner may decide): per-object build animations; public show link without sign-in (access change → approval).
- Bordy «Дизайн» Д-1…Д-4 (pages, frames, layer tree, auto layout, constraints, pen, stacked fills, SVG import, prototypes + player, task from text, copy style, PNG/SVG/PDF export) — DONE (#119).
- Д later: comments pinned on the canvas (new table + RLS → owner's approval first); variants/components; per-frame version history.
- Original Д scope: Bordy «Дизайн» on the same engine: frames with device sizes and clipping, auto layout, constraints, pen (Bezier), stacked fills, PDF/SVG on canvas, live service embeds, prototyping (triggers, actions, transitions, overlays, flows), prototype player in a separate tab with device frames. Current boards stay as «Дошка для ідей».
- Then realtime co-editing (cursors, presence, conflict-free edits) for both.
- Owner's source spec: uploaded design note (2027-01-09); no third-party product names in the repo.

## Wiki: confirmations of reading (owner, 2026-11-09; decision 2027-01-14)
- Confirm button, frozen page, statistics, new revisions — in review.

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
- **11. Boards per team:** DONE (PR after #94). Snapshot card opens as a read-only page: DONE. Spec: one task on many boards, own column per board (placements); board access per group (bind or grant); cross-board rules X@A → Y@B, any chain, only manual moves trigger; freezing columns → frozen viewers see a snapshot (no new comments/history/files/notifications) until the task returns; project switch «only admins move frozen tasks». Old note: several boards per project, each owned by a group; move a task to another team's board; rule action «when it enters column X of board 1 → appears in column Y of board 2». PR together with 10.
- **CRM (service 15):** shown as «Soon» (done); plan separately.
- **6. Analytics:** DONE (gating to the Team plan comes with payments). Was: per period/person: created, done, passed through, files, comments, text written; manager metrics (lead/cycle time, overdue, created vs done, stuck, load, reopened) on Team; workspace-wide (wiki, surveys, boards/maps/tables, active people). Guests counted; kept after leaving; deleted account → ID only. Needs approval for DB functions.

## New requests (owner, 2026-12-28) — each needs its own plan + OK
- **Wiki: media galleries:** DONE (block «Галерея», 4 layouts, audio upload). Was: A block with images, YouTube videos and audio; layouts: (1) featured — large viewer + thumbnail strip; (2) carousel/slider; (3) list — small thumbnails or text only; (4) grid/masonry with adjustable thumbnail size. Layout chosen per block.
- **Smart chips everywhere (owner, 2026-12-29).** Link any workspace thing anywhere: in a table cell, task, board, etc. insert a chip for a task, wiki page, file, calendar event, person or any service object. Look: rounded pill, light background, the service's icon first (as Google-Docs-like chips). The wiki already has page/person/task chips — extend to all services and into tables/tasks.
- **Own icons everywhere.** Redraw all system icons (now emoji) as our own drawn set, so nothing depends on third-party emoji artwork; same look in every OS. Mascot style; light/dark.
- **Mini-game «territory» with Apus.** Original game in the paint-the-ground genre: Apus leaves painted trail; enclosing area claims it; cutting/enclosing opponents' trails knocks them out.
  - Modes: offline vs bots; online real-time — joins active sessions of the same workspace, guests too (admin switch «guests may play», off → guests can't join). Needs realtime (cost/limits to check) and access change → separate approval.
  - Look: isometric 3D, clean cute minimal, warm sunlight, bright highlights.
  - Maps (procedural): (1) Ocean surface — islands, rocks (obstacles), whirlpools (traps); (2) Rooftops — irregular skyscraper roofs like continents joined by narrow bridges, city far below, edges are borders (no falling), AC/vent units as moving hazards.
  - Anti-addiction: only live stats in the session (painted %, current rank); everything resets at the end — no leaderboards, history or achievements.
  - Customisation before a game: wide palette of solid high-contrast colours + contrasting pattern overlay (pink hearts, yellow waves, light-blue dots, red crosses, white stripes…) that stays readable on the chosen colour.

## Rename EdgeKnow → Synkvela (owner, 2026-12-22) — plan separately
- UI texts (both languages), page titles, landing, emails, help, docs; logo/favicon; domain and auth redirect URLs (Vercel + Supabase settings by the owner); keep old links working (redirects).
- Service logos replace the numbered squircles on the start page (owner provides or we draw).

## Pricing (plan: `docs/pricing-uk.md`, roadmap stage 4)
- Approved: Team 6/5 $, Business 12/10 $ from 15 editors, rate 45 $/h, target MRR ≈ 3 650 $.
- Open (decide after the current roadmap is done): Free limits per service; which cross-service links are PRO.
- Device limit: 2 devices per email on all tiers and all roles (readers included), region check, paid extra device (~1 $/mo). Sign-in + personal data → owner's separate approval before coding.
- Before payments: verify official prices (Vercel, Supabase, GitHub, Claude, payment provider), taxes with an accountant, actual Actions minutes over 2–3 months.
- Implementation (later, stage 4): per-workspace feature flags + PRO badge component (greyed, explains, links to pricing); wiki export dialog with all formats (PDF/MD free; JSON/CSV/DOCX/HTML PRO).

## Context pack (`docs/context/`, 2027-01-15)
- Cards were written from the decision log and code structure; items marked "verify in code" / «звірити з кодом» need a check when that service is next touched.
- Keep `-uk` and `-en` twins in sync in the same PR.

## Known gaps / follow-ups
- Tables: package 4 DONE (array literals, ROW/COLUMN/ROWS/COLUMNS of a reference, LET, operators on ranges, FILTER/SORT/SORTBY/UNIQUE/SEQUENCE inside formulas; `scripts/test-sheet-formulas.mjs`). Left: spill into neighbouring cells (needs the editor engine to support it; separate step), LAMBDA.
- Turnstile: confirm the check shows on open forms once both Vercel keys are set.
- Open registration is a switch in the platform panel (turns on "own database first").
