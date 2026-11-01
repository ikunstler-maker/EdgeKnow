// Tasks (stage 2a): shared types and small helpers for the server and the browser.

export type TaskType = "task" | "bug" | "idea" | "epic";
export type TaskPriority = "lowest" | "low" | "medium" | "high" | "highest";
export type StatusCategory = "todo" | "doing" | "done";
export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

export const TASK_TYPES: TaskType[] = ["task", "bug", "idea", "epic"];
export const TASK_PRIORITIES: TaskPriority[] = ["highest", "high", "medium", "low", "lowest"];
export const TYPE_ICONS: Record<TaskType, string> = { task: "✅", bug: "🐞", idea: "💡", epic: "⚡" };
export const PRIORITY_ICONS: Record<TaskPriority, string> = { highest: "⏫", high: "🔼", medium: "▪️", low: "🔽", lowest: "⏬" };

export type ProjectSummary = { id: string; key: string; name: string; icon: string | null };
export type TaskStatus = { id: string; name: string; category: StatusCategory; position: number; wip_limit: number | null };
export type Person = { id: string; name: string | null; email: string };

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
};

export const TASK_COLUMNS =
  "id, number, title, status_id, type, priority, assignee_id, reporter_id, labels, start_date, due_date, estimate, parent_id, position, created_at, updated_at, done_at";

export const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

export const taskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;
export const personLabel = (person: Person | null | undefined) => (person ? person.name || person.email : "");

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
