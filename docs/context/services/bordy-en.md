# Bordy — boards and design

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `bordy-uk.md`.

## 1. Purpose

A space for thinking together and for mock-ups. Two kinds of files:
- **"Idea board"** — an infinite canvas with sticky notes, shapes, templates, voting and a timer.
- **"Design"** — an interface editor: screen frames, layers, auto layout, prototypes.

- **State:** ✅ live (both kinds).
- **URLs:** `/w/<id>/boards`, `/w/<id>/boards/<board>`.

## 2. What is built

### Idea board
- Canvas: shapes, arrows, text, pencil, section frames, zoom, save as PNG/SVG.
- Sticky notes in four colours.
- **Templates:** retrospective, brainstorm, customer journey, SWOT, kanban, grid.
- **Voting:** N votes each, result by vote count. Anyone who may comment can vote.
- **Shared timer** (1–15 minutes).
- **Images:** compressed and kept in workspace storage; the board holds only a link.
- Task from a sticky note.

### Design
- File pages, infinite canvas.
- Frames with device sizes and clipping; nesting; layer tree with search and drag.
- Auto layout (row, column, wrap; gaps, padding, alignment); constraints on frame resize.
- Pen (curves) and point editing; stacked fills and strokes; SVG import.
- **Prototypes:** transitions between frames, a player in a separate tab.
- Task from text; copy style; PNG / SVG / PDF export.

### Live co-editing — "Design" (phase 1, 2026-11-12)
- Turned on by the workspace owner (Settings → General; off by default).
- Several people in one file: others' changes show at once, avatars in the top bar, cursors with names and selection outlines in each person's colour.
- "Follow": click an avatar; your view follows their page or slide and visible area; any own action stops it; the person sees who follows them.
- Viewers' and commenters' cursors only when an editor of the document turns on "Show viewers' cursors" (the "More" menu); anyone can hide others' cursors for themselves.
- Undo takes back only one's own changes. One editor (the "leader") saves for everyone; viewers can't change the document through the channel (the database checks).

### Shared by both
- List, trash, access (owner, admins, whole workspace, people, units; guests only if shared).
- Collections in the left panel.

## 3. Planned

| What | State | Note |
|---|---|---|
| Co-editing for the idea board | planned (phase 2) | same channels and presence; no DB change expected |
| Comments pinned on the canvas | planned | new table and access rules → approval |
| Components and variants | planned | |
| Per-frame version history | planned | |
| Live service embeds on the canvas | verify in code | were in the original "Design" scope |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `boards`; kind — board or `design`) | the file: name, content, search text, version, trash; `live_viewer_cursors` — viewers' cursors when live |
| `service_object_access`, `service_object_group_access` | access |
| `board_sessions`, `board_votes` | voting and timer |
| `object_files` | images |
| `object_collections`, `object_collection_items` | collections |

## 5. Links with other services

| Service | Link |
|---|---|
| **Wika** | "Board" block on a page: editable right on the page for those with the right |
| **Rukh** | task from a sticky note or from text |
| **Kadry** | board as an embed on a slide; **shared canvas engine** with "Design" |
| **Core** | search, collections, file storage, access |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/boards/` |
| Actions | `src/app/board-actions.ts` |
| Idea board | `src/components/boards/`, `src/lib/boards.ts`, `board-templates.ts` |
| Design | `src/components/design/`, `src/lib/design.ts`, `design-server.ts` |
| Co-editing | `src/lib/live/`, `src/components/live/`, `src/app/live-actions.ts` |

## 7. Important decisions

- One own canvas engine for "Design" and presentations; the idea board runs on a separate open-licence canvas library.
- "Design" is a new file kind in the same service, not a separate service.
- The dark look of the "Design" editor is for these editors only; a light theme exists too.
- No third-party product names in the repository.

## 8. Known gaps and open questions

- Co-editing: cursors are the main cost in Supabase messages (they grow with the square of people in a file); plan limits still to settle.
- Free limit "number of boards" — open pricing question.

## Screen (updated 2026-11-11)
- The board screen is a studio: the canvas takes the whole screen; "Template", "Voting", "Timer", "Task from a sticky note" and the keys hint sit in one floating dock at the bottom. "Design" opens in the same studio with "Prototype" as the main action.
