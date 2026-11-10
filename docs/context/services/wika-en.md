# Wika — wiki

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `wika-uk.md`.

## 1. Purpose

The team's knowledge base: a page tree with a block editor, comments and access control. Wika is the **centre of the ecosystem**: objects of every other service are embedded in its pages, and the product started from it.

- **State:** ✅ live.
- **URLs:** `/w/<id>` (workspace home), `/w/<id>/p/<page>`.

## 2. What is built

### Pages and tree
- Page tree with subpages, drag and drop, move, icon, cover, author and dates.
- **Instant create:** the page appears at once, the database writes in the background; on failure — "Not saved" with retry.
- **Trash:** a deleted page is kept 30 days, then removed for good.
- Page counter (characters, words, reading time) and personal statistics in the profile.

### Editor
- Blocks: text, headings H1–H3, lists, checklists, table with cell colours, code, quote, callout, image (upload or link), YouTube, link card, navigation, table of contents.
- **Gallery:** images, YouTube, audio; four layouts.
- **Diagram** (node diagram) right in the page.
- **Chips:** page, person, task; switch chip (status, version, priority).
- **Text shows at once:** the server draws the saved page text while the editor's code is loading.
- Autosave. **Edit conflict:** if someone saved first — choose "open their version" or "keep mine".
- Content is an editor document (JSON), up to 1 MB of text per page.

### Comments and mentions
- Comments on selected text (the mark moves with the text), threads, "@" mentions.
- "Contents / Comments" switch on the side.

### Access
- Page roles: owner / edit / comment / view.
- A subpage inherits the parent's access; "Restrict access" gives it its own list.
- Access can go to the whole workspace, a person, a unit; to a guest — personally only.

### Special features
- **Read confirmations:** the page owner turns on a button ("Read" / "I accept the terms" / "I agree"); the page freezes; statistics of who confirmed; a new revision requires confirming again.
- **Page from an external source:** an admin gives a URL with Markdown — the server fills and refreshes the page.
- **Page backups** to Google Drive: daily and by button, as JSON and Markdown.
- **"Export" menu** next to "Share": copy the page link (opens only for people with access); PDF and Markdown (Free); JSON, CSV, DOCX, HTML shown greyed out with a PRO badge. PDF: a print view of the page (`/p/<id>/print`, read-only editor, light theme) waits for embeds and pictures, then opens the browser's print window ("Save as PDF") — nothing runs on the server. Markdown: built in the browser from one server action that reads the embeds with the reader's own access; tables become Markdown tables (≤500 rows per sheet), task lists become checklists, other embeds a line with a link, chips links; anything hidden becomes "🔒 No access" without its name; comments are left out. Uploaded pictures and audio go into a .zip next to the .md (`files/`); pictures from other sites stay links.

### Search
- Page titles and text, diagram nodes, link cards; by content type (headings, images, code, checklists, etc.).
- Scope: whole workspace or a page with subpages. Only what the person can open.

## 3. Planned

| What | State | Note |
|---|---|---|
| Drafts by default and "Publish" | planned | access change → separate approval; existing pages stay published |
| "Export" menu: link, PDF, Markdown | done | JSON, CSV, DOCX, HTML shown with PRO; they need payments (stage 4) |
| Real-time editing with cursors | planned (stage 3) | |
| Page version history | planned | 7 days / 1 year / unlimited by plan |
| Page templates | planned | |
| Import from other tools and Markdown | planned | |
| Public knowledge base (read without sign-in) | planned | access change → approval |
| Smart chips for any object | owner's request | |
| AI assistant in the page | planned | with the team's own key |

## 4. Data

| Table | Holds |
|---|---|
| `pages` | pages: tree, title, content, version, trash |
| `page_access`, `page_group_access` | access of people and units |
| `comment_threads`, `comments` | comments |
| `page_mentions` | mentions |
| `page_contributions` | who changed what (statistics) |
| `page_backups` | backup state |
| `page_acks`, `page_ack_revisions` | read confirmations |
| `external_sources` | external page sources |
| `attachments` | page files |

- Content is saved through `/api/pages/<id>/content` and a database function with a version check.
- The page tree for the left panel is read by `my_page_tree` (roles of all pages in one pass; test `stage51_fast_reads` compares it with reading the table row by row). A change to page access rules must update this function too.
- The tables exist in both the central and the team database.

## 5. Links with other services

| Service | Link |
|---|---|
| **Rukh** (tasks) | task chip and task list on a page; "task from selected text"; a task links to pages |
| **Bordy** (boards) | board embed |
| **Nodo** (maps) | map or diagram embed |
| **Sota** (tables) | table or chart embed; cells editable right on the page |
| **Questa** (surveys) | form or results embed |
| **Kadry** (presentations) | a wiki page is embedded in a slide as a card |
| **Core** | search, mention notifications, analytics, file storage. No collections in the wiki: the page tree replaces them |

**Embed rule:** the page stores only the object's ID. Rights are checked every time against the object, not the page.

## 6. Key files

| What | Where |
|---|---|
| Page screen | `src/app/w/[wid]/p/[id]/` |
| Page actions | `src/app/page-actions.ts`, `comment-actions.ts`, `page-ack-actions.ts`, `external-source-actions.ts` |
| Editor and blocks | `src/components/editor/` (`page-editor.tsx`, `page-preview.tsx`, `schema.ts`, `*-block.tsx`) |
| Header, sharing, cover | `src/components/pages/` |
| Logic | `src/lib/pages.ts`, `comments.ts`, `chips.ts`, `markdown.ts` (backups) |
| Export | `src/components/pages/page-export.tsx`, `page-print.tsx`, `src/app/page-export-actions.ts`, `src/lib/page-markdown.ts`, `src/lib/zip.ts`; test `scripts/test-page-markdown.mjs` |
| End-to-end tests | `scripts/e2e/wiki.mjs` |

## 7. Important decisions

- Headings H1–H3 only.
- Embedding other sites is forbidden; the exception is YouTube through its no-tracking address.
- Search is built into the database, no Ukrainian morphology (prefix match), no extra cost.
- A commenter does not change text: the server places the comment mark and verifies only it changed.
- A frozen page (with confirmations) cannot be changed by anyone until the owner starts a new revision.

## 8. Known gaps and open questions

- Drafts change access rules — a separate plan is needed: who sees a draft, what happens to subpages, how embeds and search behave.
- Export formats and the Free/PRO line depend on pricing implementation.
- Version history: where to store it and how much room it takes in a team database.
