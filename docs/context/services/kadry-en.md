# Kadry — presentations

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `kadry-uk.md`.

## 1. Purpose

Presentations with slides, styling, a show mode and live embeds from other services.

- **State:** ✅ live.
- **URLs:** `/w/<id>/slides`, `/w/<id>/slides/<deck>`, show — `/w/<id>/slides/<deck>/play`.

## 2. What is built

### Editor
- Slides on the left (drag to reorder), canvas, right panel with "Style" and "Layers" (closed by default; a toolbar button opens it).
- Objects: shapes, text, images; groups; layers.
- Style: position and size, angle, opacity; solid or gradient fill (incl. the services' brand gradients); stroke; corner radii; shadow and blur; text with several fonts.
- Themes and templates.

### Size and show
- **Slide size** is a property of the deck: a set of ready ratios or custom pixels; changeable at any time.
- **Show** in a separate tab: keyboard and click control, slide transitions.
- **Presenter view:** notes and timer.
- **PDF export.**

### Embeds
- Task, project task list, table or chart, wiki page, survey (form — can be answered during the show — or results), board, map.
- An embed is an ordinary layer: moves, resizes, rotates.

### Shared
- List, trash, access, collections, search by slide text.

## 3. Planned

| What | State | Note |
|---|---|---|
| Real-time co-editing | planned | together with Bordy "Design" |
| Per-object build animations | owner may decide | |
| Public show link without sign-in | owner may decide | access change → approval |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `slides`) | the deck: slides, layers, size, search text, version, trash |
| `service_object_access`, `service_object_group_access` | access |
| `object_files` | images |

## 5. Links with other services

| Service | Link |
|---|---|
| **Bordy** | shared canvas engine with "Design" |
| **Rukh, Sota, Wika, Questa, Bordy, Nodo** | live embeds on a slide with the viewer's rights: without access — "No access" with no name |
| **Core** | search, collections, file storage, access |
| **Profile** | "Wishlist" embed on a slide (live card) |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/slides/` |
| Actions | `src/app/slide-actions.ts` |
| Components | `src/components/slides/` |
| Logic | `src/lib/slides.ts`, `slides-server.ts`, `slide-themes.ts`, `slide-motion.ts`, `slide-guides.ts` |

## 7. Important decisions

- A slide is a frame of our own canvas engine; the same engine powers Bordy "Design".
- Embeds are the same as in the wiki; rights are checked against the object.
- Templates are drawn for 16:9 and fit any size.

## 8. Known gaps and open questions

- Free limit "number of presentations" — open pricing question.
- Which slide embeds are paid — open question.

## Screen (updated 2026-11-11)
- The deck screen is a studio: a slim 180 px slide rail ("Slide" on top, copy and delete on the thumbnail and in its right-click menu), the stage in the centre, speaker notes in a drawer at the bottom; PDF in the "Export / Import" menu, "Show" is the main action, presenter mode is under "More".
