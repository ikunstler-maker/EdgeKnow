"use client";

import dynamic from "next/dynamic";
import { dateLocale, t } from "@/i18n";
import { personLabel, type Person, type TaskField } from "@/lib/tasks";
import type { TaskComment, TaskEvent } from "./task-detail";

const TaskDescription = dynamic(() => import("./task-description"), { ssr: false, loading: () => <p className="text-sm text-muted">…</p> });
const k = t.tasks;
const s = t.tasks.snapshotPage;

export type TaskSnapshotData = {
  id: string;
  number: number;
  title: string;
  description?: unknown;
  type?: string;
  priority?: string;
  assignee_id?: string | null;
  reporter_id?: string | null;
  labels?: string[];
  start_date?: string | null;
  due_date?: string | null;
  estimate?: number | null;
  custom?: Record<string, unknown>;
};

const when = (value: string) => new Date(value).toLocaleString(dateLocale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// A task as a frozen board's people see it: the snapshot taken when it froze, and
// what was said and done before that. Nothing here can be changed.
export function TaskSnapshot({
  shortId,
  taskKey,
  snapshot,
  frozenAt,
  fields,
  members,
  comments,
  events,
  files,
}: {
  shortId: string;
  taskKey: string;
  snapshot: TaskSnapshotData;
  frozenAt: string;
  fields: TaskField[];
  members: Person[];
  comments: TaskComment[];
  events: TaskEvent[];
  files: { id: string; name: string; created_at: string }[];
}) {
  const who = (id: string | null | undefined) => (id ? personLabel(members.find((m) => m.id === id)) || s.none : s.none);
  const optionLabel = (field: TaskField, id: unknown) => field.options.find((o) => o.id === id)?.label ?? String(id);
  const customValue = (field: TaskField, value: unknown) => {
    if (value === null || value === undefined || value === "") return s.none;
    if (field.kind === "select") return optionLabel(field, value);
    if (field.kind === "multiselect" && Array.isArray(value)) return value.map((v) => optionLabel(field, v)).join(", ");
    if (field.kind === "person") return who(String(value));
    if (typeof value === "boolean") return value ? "✓" : "✗";
    return String(value);
  };
  const rows: [string, string][] = [
    [k.fields.type, k.types[snapshot.type ?? "task"] ?? snapshot.type ?? s.none],
    [k.fields.priority, k.priorities[snapshot.priority ?? "medium"] ?? s.none],
    [k.fields.assignee, who(snapshot.assignee_id)],
    [k.fields.reporter, who(snapshot.reporter_id)],
    [k.fields.labels, snapshot.labels?.length ? snapshot.labels.join(", ") : s.none],
    [k.fields.startDate, snapshot.start_date ?? s.none],
    [k.fields.dueDate, snapshot.due_date ?? s.none],
    [k.fields.estimate, snapshot.estimate === null || snapshot.estimate === undefined ? s.none : String(snapshot.estimate)],
    ...fields.map((field): [string, string] => [field.name, customValue(field, snapshot.custom?.[field.id])]),
  ];
  return (
    <div className="mt-4" data-task-snapshot>
      <p className="inline-block rounded-full bg-sky-500/15 px-3 py-1 text-sm font-medium text-sky-800 dark:text-sky-200" data-snapshot-badge>
        {s.badge(when(frozenAt))}
      </p>
      <p className="mt-2 text-sm text-muted">{s.intro}</p>
      <h1 className="mt-4 text-2xl font-semibold">
        <span className="font-mono text-base text-muted">{taskKey}</span> {snapshot.title}
      </h1>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label={k.fields.heading}>
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted">{label}:</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {Boolean(snapshot.description) && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-muted">{k.description}</h2>
          <div className="mt-2">
            <TaskDescription shortId={shortId} taskId={snapshot.id} initial={snapshot.description} editable={false} />
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-muted">{s.files}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.id}>📎 {f.name}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">{k.comments}</h2>
        <ul className="mt-2 space-y-3 text-sm" data-snapshot-comments>
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">
                {who(c.author_id)} · {when(c.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
          {!comments.length && <li className="text-muted">{s.none}</li>}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">{k.history}</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {events.map((e) => (
            <li key={e.id}>
              {when(e.created_at)} — {who(e.actor_id)} {k.historyLine[e.field] ?? e.field}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
