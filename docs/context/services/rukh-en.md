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
- Column limits, priority right on the card, choice of fields shown on the card.
- "List" view, filters.
- **Time in columns:** how long a task spent in each column (computed from history).

### Team boards
- **One task — many boards:** the same task stands in its own column on each board.
- A team board is bound to a unit and can be opened to others.
- **Rules between boards:** a move to column X on board A puts the task in column Y on board B.
- **Frozen columns and snapshot:** whoever sees a task only as a snapshot opens a read-only page as of the freezing moment.

### Fields, templates
- **Custom project fields:** text, number, select, multi-select, checkbox, toggle, date, colour, link, person. Field hint; drag order; a field can be added right from a task.
- **Task templates:** project (made by owners) and personal.

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
| Import from other trackers | planned | |
| Notifications when the site is closed (push) | planned | needs a key in hosting settings |
| Link with chat (Toker) | after chat | task from a message, notifications to a channel |
| Link with calendar (Doba) | after calendar | due dates in the calendar |
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

The tables exist in both the central and the team database.

## 5. Links with other services

| Service | Link |
|---|---|
| **Wika** (wiki) | task chip and task list on a page; status changes right from the page; task from selected text |
| **Bordy** (boards) | task from a sticky note or from text in a "Design" file |
| **Kadry** (presentations) | task card and project task list on a slide |
| **Core** | notifications (bell), analytics (created, done, overdue), search, units as rule recipients and board owners, file storage |
| **Toker, Doba, Spilno** | planned links; no details yet |

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

- From the original plan (steps З5–З7): notifications and templates are done; "My tasks", sprints, recurring tasks, query search and import are not.
- Free limit "number of projects" — open pricing question.
- Which task links with other services are paid — open question.
