"use client";

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import {
  PRIORITY_ICONS,
  TASK_PRIORITIES,
  TASK_TYPES,
  TYPE_ICONS,
  personLabel,
  taskKey,
  type Person,
  type TaskField,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";

// Filters like Jira's, for the list and the board: quick ones (people as
// avatars, "Only mine", "Recently updated") and by status, type, priority,
// label, reporter, due date, the project's own list fields and text. They
// combine, and each project remembers its last filters in this browser.

export type Filters = {
  q: string;
  people: string[]; // assignees; "none" = unassigned
  mine: boolean;
  recent: boolean;
  statuses: string[];
  types: string[];
  priorities: string[];
  labels: string[];
  reporter: string;
  due: "" | "overdue" | "week" | "none";
  custom: Record<string, string>; // own list field → item id
};

export const NO_FILTERS: Filters = { q: "", people: [], mine: false, recent: false, statuses: [], types: [], priorities: [], labels: [], reporter: "", due: "", custom: {} };

const k = t.tasks;
const f = t.tasks.filters;
const selectClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const DAY = 86_400_000;

export function useFilters(projectId: string) {
  const storageKey = `ek-task-filters-${projectId}`;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser after the first render
      if (saved) setFilters({ ...NO_FILTERS, ...JSON.parse(saved) });
    } catch {
      // Nothing remembered.
    }
  }, [storageKey]);
  const update = (next: Filters) => {
    setFilters(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not remembered this time.
    }
  };
  return [filters, update] as const;
}

export const isFiltered = (filters: Filters) => JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

export function applyFilters(tasks: TaskRow[], filters: Filters, ctx: { me: string; projectKey: string; statuses: TaskStatus[] }) {
  const q = filters.q.trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  const done = new Set(ctx.statuses.filter((s) => s.category === "done").map((s) => s.id));
  return tasks.filter((task) => {
    if (q && !task.title.toLowerCase().includes(q) && !taskKey(ctx.projectKey, task.number).toLowerCase().includes(q)) return false;
    if (filters.mine && task.assignee_id !== ctx.me) return false;
    if (filters.people.length && !filters.people.includes(task.assignee_id ?? "none")) return false;
    if (filters.recent && Date.now() - Date.parse(task.updated_at) > DAY) return false;
    if (filters.statuses.length && !filters.statuses.includes(task.status_id)) return false;
    if (filters.types.length && !filters.types.includes(task.type)) return false;
    if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false;
    if (filters.labels.length && !filters.labels.some((l) => task.labels.includes(l))) return false;
    if (filters.reporter && task.reporter_id !== filters.reporter) return false;
    if (filters.due === "none" && task.due_date) return false;
    if (filters.due === "overdue" && !(task.due_date && task.due_date < today && !done.has(task.status_id))) return false;
    if (filters.due === "week" && !(task.due_date && task.due_date >= today && task.due_date <= weekEnd)) return false;
    for (const [field, option] of Object.entries(filters.custom)) {
      if (!option) continue;
      const value = task.custom?.[field];
      if (Array.isArray(value) ? !value.includes(option) : value !== option) return false;
    }
    return true;
  });
}

const initials = (person: Person) =>
  (person.name || person.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterBar({
  filters,
  setFilters,
  members,
  statuses,
  fields,
  labels,
  showStatus = true,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  members: Person[];
  statuses: TaskStatus[];
  fields: TaskField[];
  labels: string[];
  showStatus?: boolean;
}) {
  const [more, setMore] = useState(false);
  const set = (changes: Partial<Filters>) => setFilters({ ...filters, ...changes });
  const listFields = fields.filter((field) => field.kind === "select" || field.kind === "multiselect");
  const chip = (on: boolean) => `min-h-9 rounded-full border px-3 text-xs ${on ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`;

  return (
    <div className="mt-4 space-y-2" role="search" aria-label={f.label}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder={k.search}
          aria-label={k.search}
          className={`${selectClass} min-w-0 flex-1 sm:max-w-xs`}
        />
        <div className="flex items-center -space-x-1" role="group" aria-label={k.columns.assignee}>
          {members.slice(0, 8).map((m) => (
            <button
              key={m.id}
              type="button"
              title={personLabel(m)}
              aria-label={personLabel(m)}
              aria-pressed={filters.people.includes(m.id)}
              onClick={() => set({ people: toggle(filters.people, m.id) })}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-surface text-xs font-medium ${
                filters.people.includes(m.id) ? "z-10 border-accent" : "border-background"
              }`}
            >
              {initials(m)}
            </button>
          ))}
          <button
            type="button"
            title={k.unassigned}
            aria-label={k.unassigned}
            aria-pressed={filters.people.includes("none")}
            onClick={() => set({ people: toggle(filters.people, "none") })}
            className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-surface text-xs ${filters.people.includes("none") ? "z-10 border-accent" : "border-background"}`}
          >
            ∅
          </button>
        </div>
        <button type="button" aria-pressed={filters.mine} onClick={() => set({ mine: !filters.mine })} className={chip(filters.mine)}>
          {f.mine}
        </button>
        <button type="button" aria-pressed={filters.recent} onClick={() => set({ recent: !filters.recent })} className={chip(filters.recent)}>
          {f.recent}
        </button>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className={chip(false)}>
          {f.more}
        </button>
        {isFiltered(filters) && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="min-h-9 px-2 text-xs text-muted underline hover:text-foreground">
            {f.clear}
          </button>
        )}
      </div>
      {more && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-border p-2" data-filters-more>
          {showStatus && (
            <select value="" onChange={(e) => e.target.value && set({ statuses: toggle(filters.statuses, e.target.value) })} aria-label={k.columns.status} className={selectClass}>
              <option value="">{k.columns.status}…</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {filters.statuses.includes(s.id) ? "✓ " : ""}
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <select value="" onChange={(e) => e.target.value && set({ types: toggle(filters.types, e.target.value) })} aria-label={k.columns.type} className={selectClass}>
            <option value="">{k.columns.type}…</option>
            {TASK_TYPES.map((value) => (
              <option key={value} value={value}>
                {filters.types.includes(value) ? "✓ " : ""}
                {TYPE_ICONS[value]} {k.types[value]}
              </option>
            ))}
          </select>
          <select value="" onChange={(e) => e.target.value && set({ priorities: toggle(filters.priorities, e.target.value) })} aria-label={k.columns.priority} className={selectClass}>
            <option value="">{k.columns.priority}…</option>
            {TASK_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {filters.priorities.includes(value) ? "✓ " : ""}
                {PRIORITY_ICONS[value]} {k.priorities[value]}
              </option>
            ))}
          </select>
          {labels.length > 0 && (
            <select value="" onChange={(e) => e.target.value && set({ labels: toggle(filters.labels, e.target.value) })} aria-label={k.fields.labels} className={selectClass}>
              <option value="">{k.fields.labels}…</option>
              {labels.map((label) => (
                <option key={label} value={label}>
                  {filters.labels.includes(label) ? "✓ " : ""}
                  {label}
                </option>
              ))}
            </select>
          )}
          <select value={filters.reporter} onChange={(e) => set({ reporter: e.target.value })} aria-label={k.fields.reporter} className={selectClass}>
            <option value="">{k.fields.reporter}: {f.any}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {k.fields.reporter}: {personLabel(m)}
              </option>
            ))}
          </select>
          <select value={filters.due} onChange={(e) => set({ due: e.target.value as Filters["due"] })} aria-label={k.fields.dueDate} className={selectClass}>
            <option value="">{k.fields.dueDate}: {f.any}</option>
            <option value="overdue">{f.overdue}</option>
            <option value="week">{f.thisWeek}</option>
            <option value="none">{f.noDue}</option>
          </select>
          {listFields.map((field) => (
            <select
              key={field.id}
              value={filters.custom[field.id] ?? ""}
              onChange={(e) => set({ custom: { ...filters.custom, [field.id]: e.target.value } })}
              aria-label={field.name}
              className={selectClass}
            >
              <option value="">
                {field.name}: {f.any}
              </option>
              {field.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {field.name}: {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
      {(filters.statuses.length > 0 || filters.types.length > 0 || filters.priorities.length > 0 || filters.labels.length > 0) && (
        <div className="flex flex-wrap gap-1 text-xs">
          {[
            ...filters.statuses.map((id) => ({ key: `s${id}`, label: statuses.find((s) => s.id === id)?.name ?? "", off: () => set({ statuses: toggle(filters.statuses, id) }) })),
            ...filters.types.map((v) => ({ key: `t${v}`, label: k.types[v], off: () => set({ types: toggle(filters.types, v) }) })),
            ...filters.priorities.map((v) => ({ key: `p${v}`, label: k.priorities[v], off: () => set({ priorities: toggle(filters.priorities, v) }) })),
            ...filters.labels.map((v) => ({ key: `l${v}`, label: `#${v}`, off: () => set({ labels: toggle(filters.labels, v) }) })),
          ].map((c) => (
            <button key={c.key} type="button" onClick={c.off} className="rounded-full bg-surface px-2 py-1 hover:bg-border" aria-label={f.removeFilter(c.label)}>
              {c.label} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
