# Nodo — mind maps and diagrams

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `nodo-uk.md`.

## 1. Purpose

The node space: mind maps for laying out thoughts, and diagrams for processes and simple wireframes.

- **State:** ✅ live.
- **URLs:** `/w/<id>/nodes`, `/w/<id>/nodes/<object>`.

## 2. What is built

### Mind maps
- Keyboard-driven: Tab — new branch, Enter — sibling; collapsing branches; automatic layout; colour themes.
- **Map ↔ list:** "As a list" copies the map as a bulleted list; a list can become a map.

### Diagrams
- Free blocks on a grid with alignment, connected by arrows; up to 1000 blocks.
- Shapes: rectangle, rounded, diamond, oval, note; for wireframes — button, input, card.
- Arrows with a label and a dashed style.
- The same editor as the "Diagram" block in the wiki.

### Shared
- List, trash, access, collections — like boards and tables.

## 3. Planned

| What | State |
|---|---|
| Comments on nodes | planned (stage 3) |
| Diagram from text with AI | planned with the AI assistant |
| Real-time co-editing | planned |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `nodes`; kind — map or diagram) | name, content, search text, version, trash |
| `service_object_access`, `service_object_group_access` | access |

**Nodo was the first service on the shared "service object" base**; Bordy, Sota, Questa and Kadry are built on it too.

## 5. Links with other services

| Service | Link |
|---|---|
| **Wika** | "Map" block: live view; on a map branches can be collapsed and nodes renamed if the person may edit the map; a diagram is view-only. The wiki's "Diagram" block uses the same diagram editor |
| **Kadry** | map as an embed on a slide |
| **Core** | search (node names), collections, access |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/nodes/` |
| Actions | `src/app/node-actions.ts` |
| Components | `src/components/nodes/` (`mind-map-canvas.tsx`, `node-map-screen.tsx`) |
| Diagram editor | `src/components/editor/diagram-canvas.tsx`, `src/lib/diagram.ts` |
| Logic | `src/lib/nodes.ts` |
| End-to-end tests | `scripts/e2e/nodes.mjs` |

## 7. Important decisions

- Maps and diagrams are one service, two object kinds.
- The shared "service object" base with page-like access — checked by the database.

## 8. Known gaps and open questions

- Free limit "number of maps" — open pricing question.

## Screen (updated 2026-11-11)
- The map or diagram screen is a studio: the canvas takes the full height under the bar and its toolbar.
