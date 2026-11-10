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

### Shared by both
- List, trash, access (owner, admins, whole workspace, people, units; guests only if shared).
- Collections in the left panel.

## 3. Planned

| What | State | Note |
|---|---|---|
| Real-time co-editing (cursors, presence) | planned | together with presentations; earlier postponed by the owner |
| Comments pinned on the canvas | planned | new table and access rules → approval |
| Components and variants | planned | |
| Per-frame version history | planned | |
| Live service embeds on the canvas | verify in code | were in the original "Design" scope |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `boards`; kind — board or `design`) | the file: name, content, search text, version, trash |
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

## 7. Important decisions

- One own canvas engine for "Design" and presentations; the idea board runs on a separate open-licence canvas library.
- "Design" is a new file kind in the same service, not a separate service.
- The dark look of the "Design" editor is for these editors only; a light theme exists too.
- No third-party product names in the repository.

## 8. Known gaps and open questions

- Co-editing needs a technology choice and a cost estimate.
- Free limit "number of boards" — open pricing question.
