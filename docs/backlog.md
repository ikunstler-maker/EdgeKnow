# Backlog (open work, short)

Long-term plan: `docs/roadmap-uk.md`, `docs/suite-plan-uk.md`. Decisions: `docs/decisions.md`.

## Now (owner, 2027-01-01) — 4 PRs, in order
- PR 1 Tasks: field hints + drag order, create-task dialog, drag columns — DONE (#107).
- PR 2 Instant create (tasks, wiki pages): optimistic UI, background write, "not saved" notice + retry. — DONE (#108).
- PR 3 Left panel shows only the current section (tasks: projects/boards/tasks; wiki: pages; tables: tables…); fix the old fish name near Apus. — DONE (#109).
- PR 4 Collections in the left panel (tables, boards, maps, slides, surveys, sites, apps): shared per workspace, editors+admins create; one object in many collections (link table, no copies). DB/RLS → approved 2027-01-01. — DONE (#110).

## Design system & UI overhaul (owner, 2026-11-11; decision 2026-11-11) — 6 PRs, in order
- PR 1 Foundation: surface tokens, hairlines, radii, thin scrollbars; `Icon` set; `ServiceIcon` for 15 services + home; shared `Button`/`Dialog`/`Segmented`/`Hint`; four service categories; no comparisons with other products in UI strings — DONE (#144).
- PR 2 Navigation: left panel (workspace & account menu, service switcher with Ctrl/Cmd+E, dock, collapse with Ctrl/Cmd+\, no task list), start page grouped by category, search, notifications, Apus 40×40; service marks as block glyphs from the owner's file — DONE (#145).
- PR 3 Rukh & Doba: project creation in a dialog, one header row + one filter row, new task cards; calendar header, time off; settings mark is a gear — DONE (#146).
- PR 4 Studio editors: full-viewport shell with a 48 px top bar for Sota, Kadry, Bordy, Nodo; Export / Import and More menus; file-format names instead of program names in the table strings — in review.
- PR 5 Wika, Questa, Obriy: page top bar, the title once, contents rail on the right; survey tabs and builder; app gallery.
- PR 6 The rest: profile, settings, every dialog, trash, analytics, sign-in, `/about` (its emoji), `/changelog`, `/help`; final emoji sweep with an automatic check.
- Rules for all six: no database, access or server-action changes; phone controls stay 44 px; test hooks stay, a scenario step is updated only where the control itself changes kind; pinned services and the collapsed panel are remembered per browser. Emoji a person picked (Wika page icons, Rukh project icons) stay.

## Workspace settings (owner, 2026-11-11; decision 2026-11-11)
- PR 1: 8 tabs → 5 (Team & structure, Roles & security, Data & storage), members table + member card — DONE (#142).
- PR 2: active sessions — admin sees a member's devices (type, last activity, no IP) and ends all their sessions (signed out everywhere, logged); the person sees and ends own devices in the profile; proxy checks the session still exists. Reads Supabase's own sessions, no new table. DB/sign-in → approved 2026-11-11 — in review.
- Later: device limit 3 per email (card shows «Скоро»); SSO (PRO).

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

## Wiki: order agreed (owner, 2026-11-10)
- 1. Export menu: copy link + PDF/MD (free); JSON/CSV/DOCX/HTML shown disabled with PRO badge — in review (decision 2027-01-23). Formats behind PRO arrive with payments (stage 4).
- 2. Drafts by default + Publish — in review (owner approved the rules; decision 2027-01-26). Later: "back to draft".
- 3. Page version history — in review (decision 2027-01-29). Later: longer history on paid plans (1 year / unlimited).
- Later: templates (base + own); import from Markdown and other tools; smart chips for any object (files, events, any service object); public knowledge base (access change → approval); realtime co-editing with cursors; AI helper with the team's own key; readers never load the editor.
- Later, promised on the landing («Знання, яким довіряють», marked «Скоро»): glossary with hover hints; "what changed since your last visit" (new/changed paragraphs highlighted); review-by date with a reminder to the page owner; onboarding routes ("first week", per-person progress, mini-quizzes); approval before publishing (readers see only the approved version — builds on drafts).

## Next by plan
- Chat (suite plan, after surveys) → Presentations → Files manager (roadmap stage 2b).
- Boards Д2: realtime co-editing (postponed by the owner).
- Organization level, shared objects between workspaces (later).

## New directions (2026-11-05, roadmap stage 2c) — each needs its own plan + OK
- Wiki: drafts by default + Publish (RLS change → approval); Share button (copy link, export with format list).
- Tables: user scripts (sandboxed). AI: transcription, dictation, node automations, local LLM / MCP models.
- Service «Персональна сторінка»: company landing builder (Free blocks, Team custom code), custom-code corporate pages (Business), block business cards (company + profile, Free).
- Service «Корпоративні додатки» (Obriy; decision 2027-02-02):
  - О-1 gallery of the company's outside apps (tiles, metadata from the link, admins manage, opens in a new tab) — in review.
  - О-2 financial monitoring (FinPulse) inside the platform: data in the workspace DB, workspace admins only (= "organization admin" until the Organization level), Team+. New tables/RLS → owner's approval first; needs the FinPulse repository.
  - Later: search across apps (with presentations); showing an app inside the platform (site policy change → approval); app catalogue.
- Shown on `/about` and the start page as «Скоро» (done 2026-11-05).

## Requested by the owner (2026-11-04), not planned in detail yet
- **Corporate calendar** → planned in detail, see «Doba» below (decision 2027-01-21).
- **Video meetings (later, after Chat).** Own alternative to Meet/Zoom inside the ecosystem: from chat channels, synced with the calendar and tasks. Plan separately (likely WebRTC with a hosted SFU; cost/licence check first).

## Doba: calendar + time off (owner approved 2026-11-10; decision 2027-01-21)
- 1а events — DONE (#129).
- 1б time off — DONE (#130).
- Phase 2 (owner approved 2026-11-10; decision 2027-01-24), three PRs:
  - 2а repeats and reminders — DONE (#132).
  - 2б — DONE (#134).
  - 2в — DONE (#135).
  - 2г — DONE (#137).
- Later: drag to create on touch screens (long press); moving and resizing an existing event by dragging; event chip in task descriptions (with "smart chips everywhere": the task description has no chips at all yet); dragging a task to another day on the calendar; reminders when the site is closed (with push); an answer for one day of a series ("not going this time"); a repeat "on the last Friday of the month"; the landing card without "Soon" once sync (phase 3) is planned.
- Phase 3, external calendars (owner approved 2026-11-10; decision 2027-01-30). Neutral names only; a provider's name is allowed on its sign-in button alone.
  - 3а the person's own feed (read-only address for calendar apps; table `calendar_feeds`, open route `/api/calendar-feed/`) — DONE (#138).
  - 3б busy time from an outside calendar by its feed address (decision 2027-01-31) — DONE (#139). Needs `CALENDAR_TOKEN_KEY` in Vercel (owner); until then the section says "not set up yet".
  - Later for 3б: several addresses per person; own outside busy time in the month and list views (today: the week only).
  - 3в sign-in with a provider — architecture decided (2027-02-01), **code on hold until the owner's separate OK**: first watch 3а and 3б in use; the owner sets up the permissions and the app review in the provider's console. Strictly minimal access (busy time without details from the primary calendar + writing only into the app's own "Doba" calendar); 3в-1 sign-in and busy time, 3в-2 Doba events into the "Doba" calendar; on disconnect ask whether to delete that calendar and always revoke the token at the provider; `calendar_connections` gets new fields, new central `calendar_external_links`; PRO mark.
- Follow-up: the landing and the comparison table still name third-party calendars (older text) — clean up with the rename work.

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
- **Own icons everywhere** — in progress, see «Design system & UI overhaul» above. Was: Redraw all system icons (now emoji) as our own drawn set, so nothing depends on third-party emoji artwork; same look in every OS. Mascot style; light/dark.
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

## Speed (owner approved 2026-11-10; decision 2027-01-16) — each step its own PR, measure before/after
- Step 1 server region next to the database (Vercel `dub1` = Supabase eu-west-1) — DONE.
- Step 2 fewer round trips — DONE (part): the workspace layout loads everything in one wave (was 4 in a row), the team lookup is one wave, member sync runs after the response, the wiki page loads its source and confirmations together. Left: one RPC for the proxy check + workspace + role (needs a migration).
- Wiki page text at once — DONE: the saved text is drawn by the server (`page-preview.tsx`) until the editor's code arrives. Left: readers never load the editor (needs a read-only renderer for every block kind).
- Links in the left panel, service tiles, task cards and chips no longer fetch ahead (`prefetch={false}`) — DONE: every page view fired a request per visible link (owner's Network tab, 2026-11-10: ~25 requests of 0.2–0.9 s, each two database calls in the proxy, returning ~0.9 kB of nothing useful because every page is per-user).
- Measuring: `/api/admin/timing?w=<short id>` (platform admin only, numbers only) times each server step of opening a workspace page. Region confirmed `dub1` (x-vercel-id, 2026-11-10), yet the document still takes ~1.1 s and a trivial server action ~0.5 s — find which step. Remove the route when the speed work is done.
- `project_tasks()` — DONE: a project's tasks in one pass (locally 300 tasks 1 160 ms → 11 ms, same rows; `stage52_fast_tasks`). Loading line at the top — DONE (`nav-progress.tsx`).
- Owner's Lighthouse after `workspace_context`/`my_page_tree` (2026-11-10): document 1.14 s → 0.61 s, first paint 1.30 → 0.74 s, a server action 0.52–0.56 → 0.27–0.42 s. The simulated-phone score stays ~52: it is the browser's work (editor code), not the server.
- Step 3 (below) is now low value: the layout it would skip costs one wave (~60 ms) since the two functions; risky across 20 action files — leave unless measurements say otherwise.
- Step 3 after an action refresh only what changed (now every action calls `revalidatePath("/", "layout")`: whole client cache dropped, layout re-rendered).
- Step 4 loading indicator — NOT done: a `loading.tsx` for `/w/[wid]` was tried and removed (2026-11-10): the page then wakes up (hydrates) later behind its Suspense boundary and end-to-end checks that act right after a page shows failed (deck player keys, task files, epic progress). Do it as a thin progress bar at the top instead (link status / transition), which doesn't change how pages load.
- External-source pictures: every picture is fetched from the source on each cold view (~2 s each in the owner's Lighthouse report, 2026-11-10); keep a copy after the first fetch (storage → plan first). Its route also asks the auth server (`getUser`) per picture.
- Measured in production (2026-11-10, `/api/admin/timing`): any database call 26–50 ms; page tree of 19 pages 136–224 ms; workspace lookup three calls deep. DONE in response: `workspace_context()` (one call) and `my_page_tree()` (one pass; locally 310 pages 200–270 ms → 4–5 ms, same rows). Next candidates by the same method: tasks of a project (`task_project_role`/`task_read_until` per row), service objects.
- Step 5 access checks once per query, not per row (RLS → approved by the owner in principle; same visibility, security tests must give the same output). Measured locally: 310 pages 0.2–0.27 s, 300 tasks ~1 s vs 0.0002 s without checks (`effective_role`, `task_project_role`, `task_read_until` per row). Small workspaces don't feel it yet; needed before big ones and before realtime co-editing.
- Later: ship only the current language's strings to the browser (both dictionaries, ~390 KB source, go to every page now).
- Worldwide: one server region serves one database region well; team-owned databases in other regions and far-away users need a separate plan (regions per workspace or edge reads).

## Known gaps / follow-ups
- Tables: package 4 DONE (array literals, ROW/COLUMN/ROWS/COLUMNS of a reference, LET, operators on ranges, FILTER/SORT/SORTBY/UNIQUE/SEQUENCE inside formulas; `scripts/test-sheet-formulas.mjs`). Left: spill into neighbouring cells (needs the editor engine to support it; separate step), LAMBDA.
- Turnstile: confirm the check shows on open forms once both Vercel keys are set.
- Open registration is a switch in the platform panel (turns on "own database first").
