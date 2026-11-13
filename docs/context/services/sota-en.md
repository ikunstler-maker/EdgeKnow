# Sota — tables and charts

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `sota-uk.md`.

## 1. Purpose

Spreadsheets with formulas people already know, Excel/CSV files and charts that update themselves. Sota is also the **structured-data store for other services** (survey answers).

- **State:** ✅ live.
- **URLs:** `/w/<id>/sheets`, `/w/<id>/sheets/<table>`.

## 2. What is built

### Editor
- Sheets, cell formats, sorting and filters, freezing, colours and borders, merging, conditional formatting, data validation, comments, find and replace.
- The editor UI is translated to Ukrainian by our own patch to the library.

### Formulas
- Excel-compatible formulas, verified by our own test set.
- Present: array literals, ROW/COLUMN, LET, operations on ranges, FILTER, SORT, SORTBY, UNIQUE, SEQUENCE inside other formulas.
- **Missing:** spilling a result into neighbouring cells, and LAMBDA.

### Files
- Open Excel or CSV as a new table; add sheets from a file.
- Save to Excel (whole table) or CSV (current sheet).
- Values, formulas, formats, styles, widths and merges carry over.

### Charts
- Kinds: columns, bars, lines, areas, pie, doughnut, scatter.
- A chart stores only "where the data is and how to draw", so it updates with every cell change.

### Chips in cells (UI-2, 2026-11-13)
- A cell whose text is a link to this workspace (page, task, table, board, map, slides, survey, app, wishlist, Vault file) is drawn as a chip: the service's mark and the current title, read with the viewer's access ("No access" otherwise). The cell keeps the link only; formulas and exports see the link.
- "Insert chip" above the toolbar searches what the person sees and writes the link into the selected cell; a selected chip cell offers "Open «title»". Drawn through the table's own `afterRenderCell` hook (`src/components/sheets/sheet-chips.ts`, `chip-picker.tsx`); titles load batched and the table redraws itself when they arrive.

### Shared
- List, trash, access, collections. Table size limit — 1 MB.

## 3. Planned

| What | State | Note |
|---|---|---|
| User scripts | planned | sandboxed execution → security approval; Team and above |
| Formula spill and LAMBDA | planned | needs editor support |
| Smart chips in cells | owner's request | |
| Real-time co-editing | planned | |

## 4. Data

| Table | Holds |
|---|---|
| `service_objects` (service `sheets`) | the table: sheets, charts, search text, version, trash |
| `service_object_access`, `service_object_group_access` | access |

## 5. Links with other services

| Service | Link |
|---|---|
| **Questa** | connected table: each answer is a row of the "Answers" sheet; new questions — new columns |
| **Wika** | "Table" block: the whole table or one chart; cells editable right on the page |
| **Kadry** | table or chart on a slide |
| **Core** | search (names, sheets, cell text), collections, access |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/sheets/` |
| Actions | `src/app/sheet-actions.ts` |
| Components | `src/components/sheets/` |
| Logic | `src/lib/sheets.ts`, `sheet-functions.ts`, `sheet-io.ts`, `sheet-charts.ts` |
| Formula tests | `scripts/test-sheet-formulas.mjs` |

## 7. Important decisions

- Formula and editor libraries — permissive licences only.
- A formula is stored as the person wrote it; it is rewritten only for evaluation.
- If a table is being edited when a new survey answer arrives, the editor sees "the table was changed".

## 8. Known gaps and open questions

- The end-to-end test of the table embed in the wiki used to be flaky — verify the current state.
- Scripts: where they run, which limits, what they may read.
- Free limit "number of tables" — open pricing question.

## Screen (updated 2026-11-11)
- The table screen is a studio: the grid takes the full height; charts live in a side panel ("Charts" in the bar, "New chart" is the main action); saving as XLSX/CSV and adding sheets from a file are in the "Export / Import" menu.
