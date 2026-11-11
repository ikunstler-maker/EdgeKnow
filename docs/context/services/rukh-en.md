# Rukh — tasks

> **Service card.** Read with `docs/context/00-overview-en.md`. **State as of:** 2027-01-14. Source of truth: `docs/decisions.md` and the code. Ukrainian twin: `rukh-uk.md`.

## 1. Purpose

The team's task tracker: projects, boards with columns, custom fields, links, rules and notifications. Simpler and faster than classic trackers, with a live link between tasks and wiki pages.

- **State:** ✅ live.
- **URLs:** `/w/<id>/tasks` (projects), `/w/<id>/tasks/<KEY>` (project); a task by a key like `MKT-12`.

## 2. What is built

### Projects and tasks
- A project has a key (e.g. MKT); tasks are numbered `MKT-N` with no gaps.
- Task: title, description (with images), type (task, bug, idea, epic), priority, status, assignee, co-assignees, responsible people, due date, labels, estimate.
- **Created in a separate dialog**; **instant create** — a "Saving…" card, on failure "Not saved" with retry (unsaved ones stay in the browser).
- **Private tasks:** "Only for me"; visible to the author, assignee, co-assignees and responsible people. Admins see only the count and people, not the content (there is a switch in workspace settings).

### Board and list
- Columns are statuses. Column types: "To do", "In progress", "In review", "Done".
- Drag between and inside columns; on a phone — long press. Columns themselves can be dragged.
- Column limits, choice of fields shown on the card.
- **Task card** (updated 2026-11-11): the key and a priority mark on top, then the title, and at the bottom compact marks of the chosen fields (type, dates, estimate, labels, own fields) with the assignee's avatar. A field with no value takes no room. Priority and assignee change right on the card: a click on the mark or the avatar opens a short list.
- **Project screen:** one header row (the project, "Board / List", and on the right "Task fields", "Templates", "Access and settings") and one filter row (search, people, quick filters, grouping, card fields, notification rules, board settings, "New task"). A new project is created in a dialog from the "New project" button. The left panel is a tree: projects → their boards → the tasks on each board (every level folds; the open project is unfolded). A task there shows a dot in its column's colour on the left and its priority on the right, and opens over its board. Boards are also switched by the tabs above the columns. A new column is added with a small "+" at the end of the row; arrows on the edges of the row say there are more columns that way.
- "List" view, filters.
- **Board at scale (2026-11-11):** grouping by assignee shows a foldable lane per person (avatar, name, count); card order (as arranged, newest, oldest, recently changed, nearest due, priority, waiting longest) and a time filter (changed in 7/30 days, in the column 3+/7+ days — counted from when the task came to the column on this board); a column folds to a narrow strip and its cards are not drawn; a long column draws 50 cards and "Show more"; all of it is remembered per project in the browser. Tasks and placements are read a thousand at a time, so projects with thousands of tasks show fully.
- **Time in columns:** how long a task spent in each column (computed from history).

### Team boards
- **One task — many boards:** the same task stands in its own column on each board.
- A team board is bound to a unit and can be opened to others.
- **Rules between boards:** a move to column X on board A puts the task in column Y on board B.
- **Frozen columns and snapshot:** whoever sees a task only as a snapshot opens a read-only page as of the freezing moment.

### Fields, templates
- **Custom project fields:** text, number, select, multi-select, checkbox, toggle, date, colour, link, person. Field hint; drag order; a field can be added right from a task.
- **Task templates:** project (made by owners) and personal.

### Task screen (updated 2026-11-11, steps Р-1 and Р-2)
- **Two columns:** on the left the title, status, description, subtasks, links, pages that mention it, files, and "Comments / History" tabs; on the right the properties panel (assignee, co-assignees, responsible, priority, type, dates, estimate, labels, parent task, the project's own fields, privacy, time in columns, author and dates). On a narrow screen the properties come right after the description.
- **People** are picked from a list with search and shown as marks with avatars. The **parent task** and the other task of a **link** are found by key or words of the title. **Labels** are coloured marks; the project's existing labels are offered while typing.
- More than three empty own fields fold under "More fields (N)".
- **History:** a run of description autosaves by one person is one line ("N edits"); status, people, priority, dates and title lines say what changed to what. Description autosaves are read apart, so they can't push other changes out of the list.
- **Panel over the board:** a task opened from the board or the list shows in a sheet on the right (the whole screen on a phone); the address carries `?task=N`, so it can be shared and "Back" closes it. Closes with ✕, a tap outside or Escape. The task's own page `/tasks/<KEY>/<N>` stays (it is what "Copy link" copies) — both addresses open the task.
- Browser tab titles of the service end with "Rukh".

### Move from another tracker (step Р-3а, 2026-11-11)
- A wizard for the workspace's owner and admins (`/w/<id>/tasks/import`, the button on the projects page): connect (any link from the cloud tracker, account email, access key) → what goes where → dry run on the first three tasks → move → report.
- **Tasks keep their numbers** (`TMD-7` stays `TMD-7`; the next new task gets the number after the tracker's last), creation and update dates, the description with formatting (headings, lists, checklists, code, tables, links), type, priority, labels, due and start dates, estimate, epics and subtasks, links (blocks, relates, duplicates) and chosen custom fields (text, number, date, one or several options, person, link — made in the project automatically).
- **Statuses → columns:** a new project gets columns with the tracker's names in its order; when joining an existing project each status goes to a chosen column or a new one.
- **People** are matched by email (when the tracker shows it) or by a name only one member has, and can be chosen by hand; someone who is not a member stays as a name in text (`imported_reporter`, `imported_assignee`).
- **The key is busy?** Three ways: change the key of the existing project (tasks keep their numbers under the new key), join with it (its own tasks move to numbers after the imported ones), or a new project under another key. A project's key can also be changed any time in "Access and settings" (owner of the project or a workspace admin; written to the log).
- Nobody is notified about imported tasks and no "changed" lines are written; each task gets its original "created" line. Running an import again updates tasks by their old key and never doubles them. The move runs page by page while the wizard is open and continues from where it stopped.
- **The access key** is kept encrypted in `task_imports` (central database, server only, never sent to the browser) and can be deleted with the connection. The tracker is only read. Only the vendor's cloud addresses are accepted. The tracker's name shows only in the wizard's source list.
- An imported task shows "Moved from <old key>" with a link to the old tracker.

### Hierarchy and links
- Subtasks and epic tasks; "Done N of M" bar; subtasks from the description's checklist.
- Links between workspace tasks: blocks, relates, duplicates.

### Files, comments, history
- Files up to 4 MB (images, PDF, office documents, ZIP) in the workspace's single storage.
- Comments with mentions; full change history.

### Notification rules
- The project owner sets: event (a column of a type or a specific one, assignee or due date change, comment) → whom to tell (assignee, author, owners, people, units).

### Access
- Projects are created by those whose role allows it.
- Project access: whole workspace (edit, comment or view) or closed with access for people and units.
- A guest sees only projects shared with them.

## 3. Planned

| What | State | Note |
|---|---|---|
| "My tasks" (today, overdue, next) | planned, not built | partly covered by notifications and analytics today |
| Sprints and backlog | planned | turned on per project |
| Recurring tasks | planned | |
| Advanced query search | planned | |
| Move from another tracker, step 3б | planned (owner approved) | comments with dates and authors, status history, files to the team's Google Drive (up to 250 MB a file, 10 GB a ZIP; what did not come over is listed and can be pulled later) |
| Move from another tracker, step 3в | planned (owner approved) | one-way catch-up while the team moves; search by the old key and link |
| Import from an export file (CSV) | later | for other trackers |
| Notifications when the site is closed (push) | planned | needs a key in hosting settings |
| Link with chat (Toker) | after chat | task from a message, notifications to a channel |
| Smart chips in fields and description | owner's request | |

## 4. Data

| Table | Holds |
|---|---|
| `task_projects` | projects |
| `task_project_access`, `task_project_group_access` | project access |
| `task_statuses` | columns |
| `tasks` | tasks |
| `task_participants` | co-assignees and responsible people |
| `task_boards`, `task_board_access`, `task_placements` | team boards and a task's place on each |
| `task_fields` | custom fields |
| `task_templates` | templates |
| `task_links` | links between tasks |
| `task_page_links` | links between tasks and wiki pages |
| `task_comments`, `task_events` | comments and history |
| `task_files` | files |
| `task_rules` | notification rules and rules between boards |
| `task_imports` (central database only, server only) | a move from another tracker: its address, the encrypted access key, the mapping, progress and report |

A project's tasks for the board and the list are read by `project_tasks` (access worked out once per call; test `stage52_fast_tasks` compares it with reading the table). A change to task visibility rules must update this function too.

The tables exist in both the central and the team database.

## 5. Links with other services

| Service | Link |
|---|---|
| **Wika** (wiki) | task chip and task list on a page; status changes right from the page; task from selected text |
| **Bordy** (boards) | task from a sticky note or from text in a "Design" file |
| **Kadry** (presentations) | task card and project task list on a slide |
| **Core** | notifications (bell), analytics (created, done, overdue), search, units as rule recipients and board owners, file storage |
| **Doba** | tasks with a due date show on the calendar (mine or all the person can read; read-only there). The calendar calls `project_tasks` for every project, so it follows the task visibility rules by itself — private tasks included |
| **Toker, Spilno** | planned links; no details yet |

## 6. Key files

| What | Where |
|---|---|
| Screens | `src/app/w/[wid]/tasks/` |
| Actions | `src/app/task-actions.ts`, `task-file-actions.ts`, `task-wiki-actions.ts` |
| Components | `src/components/tasks/` (`task-board.tsx`, `task-detail.tsx`, `new-task-dialog.tsx`, `fields-editor.tsx`, `task-rules.tsx`) |
| Logic | `src/lib/tasks.ts`, `src/lib/tasks-server.ts` |
| Wiki blocks | `src/components/editor/task-blocks.tsx` |
| End-to-end tests | `scripts/e2e/tasks.mjs` |
| Original plan | `docs/tasks-plan-uk.md` |

## 7. Important decisions

- Tasks are a section of the platform, not a separate product with sync.
- "Required" only marks an empty field and does not block saving (otherwise quick create breaks).
- A task on several boards is one task with the same number; the "main" column is on the board where it was created.
- Rules between boards fire only on a manual move (no endless chains).
- Task privacy hides everything: comments, history, files, links, mentions, notifications.

## 8. Known gaps and open questions

- From the original plan (steps З5–З7): notifications and templates are done; the move from another tracker is under way (Р-3а done); "My tasks", sprints, recurring tasks and query search are not.
- Free limit "number of projects" — open pricing question.
- Which task links with other services are paid — open question.
