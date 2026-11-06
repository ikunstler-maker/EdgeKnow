// Tasks (stage 2a): shared types and small helpers for the server and the browser.

import { t } from "@/i18n";

export type TaskType = "task" | "bug" | "idea" | "epic";
export type TaskPriority = "lowest" | "low" | "medium" | "high" | "highest";
export type StatusCategory = "todo" | "doing" | "review" | "done";
export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

export const TASK_TYPES: TaskType[] = ["task", "bug", "idea", "epic"];
export const TASK_PRIORITIES: TaskPriority[] = ["highest", "high", "medium", "low", "lowest"];
export const TYPE_ICONS: Record<TaskType, string> = { task: "✅", bug: "🐞", idea: "💡", epic: "⚡" };
export const PRIORITY_ICONS: Record<TaskPriority, string> = { highest: "⏫", high: "🔼", medium: "▪️", low: "🔽", lowest: "⏬" };

export type ProjectSummary = { id: string; key: string; name: string; icon: string | null };
export type TaskStatus = { id: string; name: string; category: StatusCategory; position: number; wip_limit: number | null; board_id?: string | null };
// Extra boards of a project, each for a team (package 11); columns without a board are on the main one.
export type TaskBoardInfo = { id: string; name: string; group_id: string | null; position: number };
// `guest`: shown with the mark «Гість» wherever the person appears.
export type Person = { id: string; name: string | null; email: string; guest?: boolean };

export type TaskRow = {
  id: string;
  number: number;
  title: string;
  status_id: string;
  type: TaskType;
  priority: TaskPriority;
  assignee_id: string | null;
  reporter_id: string | null;
  labels: string[];
  start_date: string | null;
  due_date: string | null;
  estimate: number | null;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  // The project's own fields: {"<field id>": value}.
  custom: Record<string, unknown>;
  // Seen only by its author, assignee and participants (package 10).
  private?: boolean;
};

export type FieldKind = "text" | "longtext" | "number" | "select" | "multiselect" | "checkbox" | "toggle" | "date" | "color" | "url" | "person";
export const FIELD_KINDS: FieldKind[] = ["text", "longtext", "number", "select", "multiselect", "checkbox", "toggle", "date", "color", "url", "person"];
export type FieldOption = { id: string; label: string; color?: string | null };
export type TaskField = {
  id: string;
  name: string;
  kind: FieldKind;
  options: FieldOption[];
  required: boolean;
  task_types: TaskType[] | null;
  position: number;
};
// What a board card can show; the project's own fields join by id.
export const CARD_FIELDS = ["key", "type", "priority", "assignee", "reporter", "labels", "due", "start", "created", "updated", "estimate", "subtasks"] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export const fieldApplies = (field: TaskField, type: TaskType) => !field.task_types || field.task_types.includes(type);
export const isEmptyValue = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

export const TASK_COLUMNS =
  "id, number, title, status_id, type, priority, assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, created_at, updated_at, done_at, custom, private";

export const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

export const taskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;
export const personLabel = (person: Person | null | undefined) =>
  person ? `${person.name || person.email}${person.guest ? ` · ${t.workspace.roles.guest}` : ""}` : "";

// "MKT-12" → ["MKT", 12]
export function parseTaskKey(value: string): [string, number] | null {
  const match = value.trim().toUpperCase().match(/^([A-Z][A-Z0-9]{1,9})-(\d{1,7})$/);
  return match ? [match[1], Number(match[2])] : null;
}

// A suggested key from a project name: "Маркетинг і дизайн" → "MD", "Design" → "DES".
const LATIN: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "H", ґ: "G", д: "D", е: "E", є: "YE", ж: "ZH", з: "Z", и: "Y", і: "I", ї: "YI", й: "Y", к: "K", л: "L",
  м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F", х: "KH", ц: "TS", ч: "CH", ш: "SH", щ: "SHCH", ь: "", ю: "YU", я: "YA",
};
export function suggestKey(name: string) {
  const latin = name
    .toLowerCase()
    .split("")
    .map((c) => LATIN[c] ?? c.toUpperCase())
    .join("")
    .replace(/[^A-Z0-9 ]/g, " ");
  const words = latin.split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  const clean = key.replace(/^[0-9]+/, "").slice(0, 10);
  return clean.length >= 2 ? clean : `${clean}T`.padEnd(2, "T");
}

// Step Z3: links between tasks ("source blocks / relates to / duplicates target").
export type LinkKind = "blocks" | "relates" | "duplicates";
export type TaskLink = { id: string; source_id: string; target_id: string; kind: LinkKind };
// A task of a link as the reader may see it (null fields: no access).
export type LinkedTask = { id: string; key: string | null; title: string | null; done: boolean | null; deleted: boolean };

// How many children (subtasks, or tasks of an epic) are done, per parent.
export function progressOf(tasks: Pick<TaskRow, "parent_id" | "status_id">[], statuses: TaskStatus[]) {
  const done = new Set(statuses.filter((s) => s.category === "done").map((s) => s.id));
  const progress = new Map<string, { done: number; total: number }>();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    const entry = progress.get(task.parent_id) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (done.has(task.status_id)) entry.done += 1;
    progress.set(task.parent_id, entry);
  }
  return progress;
}

// Tasks blocked by an unfinished task. A blocker the reader can't see counts as unfinished.
// `blockerDone`: id → done (true/false; a deleted blocker counts as done); missing ids are hidden tasks.
export function blockedTasks(links: TaskLink[], blockerDone: Map<string, boolean>) {
  const blocked = new Set<string>();
  for (const link of links) {
    if (link.kind !== "blocks") continue;
    if (blockerDone.get(link.source_id) !== true) blocked.add(link.target_id);
  }
  return blocked;
}

// The unchecked items of a BlockNote checklist (in any depth of the description).
export function openChecklistItems(description: unknown): string[] {
  const items: string[] = [];
  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks as { type?: string; props?: { checked?: boolean }; content?: unknown; children?: unknown }[]) {
      if (block?.type === "checkListItem" && !block.props?.checked) {
        const text = Array.isArray(block.content)
          ? (block.content as { type?: string; text?: string; content?: { text?: string }[] }[])
              .map((c) => c.text ?? (Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join("") : ""))
              .join("")
              .trim()
          : "";
        if (text) items.push(text.slice(0, 300));
      }
      walk(block?.children);
    }
  };
  walk(description);
  return items;
}

// Time a task spent in each column, from its history: every status change is
// a logged event (column ids, so renaming or reordering columns changes nothing).
// Repeated visits add up. The column it is in now counts until now, except the
// last column, which counts only when the project turns that on.
export type StatusMove = { old_value: unknown; new_value: unknown; created_at: string };
export function columnTimes(
  task: { created_at: string; status_id: string },
  moves: StatusMove[],
  statuses: { id: string; position: number }[],
  countLast: boolean,
  now = Date.now(),
): Map<string, number> {
  const sorted = [...moves].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const spent = new Map<string, number>();
  const add = (status: string, from: number, to: number) => {
    if (to > from) spent.set(status, (spent.get(status) ?? 0) + (to - from));
  };
  let status = typeof sorted[0]?.old_value === "string" ? (sorted[0].old_value as string) : task.status_id;
  let since = Date.parse(task.created_at);
  for (const move of sorted) {
    const at = Date.parse(move.created_at);
    add(status, since, at);
    if (typeof move.new_value === "string") status = move.new_value;
    since = at;
  }
  const last = [...statuses].sort((a, b) => a.position - b.position).at(-1)?.id;
  add(status, since, now);
  if (!countLast && last) spent.delete(last);
  return spent;
}
