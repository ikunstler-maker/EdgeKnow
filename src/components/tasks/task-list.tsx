"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import {
  PRIORITY_ICONS,
  TASK_PRIORITIES,
  TASK_TYPES,
  TYPE_ICONS,
  personLabel,
  taskKey,
  type Person,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";
import { createTask } from "@/app/task-actions";

const k = t.tasks;
const inputClass = "min-h-11 rounded-md border border-border bg-background px-3 text-base md:min-h-9 md:text-sm";

const shortDate = (value: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(value));

// The project's tasks with quick filters and a one-line way to add a task.
export function TaskList({
  shortId,
  project,
  statuses,
  tasks,
  members,
  me,
  canEdit,
}: {
  shortId: string;
  project: { id: string; key: string };
  statuses: TaskStatus[];
  tasks: TaskRow[];
  members: Person[];
  me: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");

  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const today = new Date().toISOString().slice(0, 10);

  const shown = tasks.filter((task) => {
    const q = query.trim().toLowerCase();
    if (q && !task.title.toLowerCase().includes(q) && !taskKey(project.key, task.number).toLowerCase().includes(q)) return false;
    if (status && task.status_id !== status) return false;
    if (assignee === "me" && task.assignee_id !== me) return false;
    if (assignee === "none" && task.assignee_id) return false;
    if (assignee && assignee !== "me" && assignee !== "none" && task.assignee_id !== assignee) return false;
    if (type && task.type !== type) return false;
    if (priority && task.priority !== priority) return false;
    return true;
  });

  return (
    <div className="mt-6">
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (!value) return;
            startTransition(async () => {
              const result = await createTask(project.id, { title: value });
              if (!result.ok) return setError(k.errors[result.error] ?? t.common.unknownError);
              setError(null);
              setTitle("");
              router.refresh();
            });
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={k.quickCreate}
            aria-label={k.quickCreateLabel}
            maxLength={300}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button type="submit" disabled={pending || !title.trim()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
            {k.create}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2" role="search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={k.search} aria-label={k.search} className={`${inputClass} min-w-0 flex-1`} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={k.columns.status} className={inputClass}>
          <option value="">{k.allStatuses}</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={k.columns.assignee} className={inputClass}>
          <option value="">{k.allAssignees}</option>
          <option value="me">{k.me}</option>
          <option value="none">{k.unassigned}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {personLabel(m)}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={k.columns.type} className={inputClass}>
          <option value="">{k.columns.type}</option>
          {TASK_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE_ICONS[value]} {k.types[value]}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={k.columns.priority} className={inputClass}>
          <option value="">{k.columns.priority}</option>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {PRIORITY_ICONS[value]} {k.priorities[value]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted">{k.count(shown.length, tasks.length)}</p>

      {tasks.length === 0 ? (
        <p className="mt-6 text-muted">{k.noTasks}</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-muted">{k.nothingFound}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm" data-task-list>
            <thead className="bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{k.columns.key}</th>
                <th className="px-3 py-2 font-medium">{k.columns.title}</th>
                <th className="px-3 py-2 font-medium">{k.columns.status}</th>
                <th className="px-3 py-2 font-medium">{k.columns.assignee}</th>
                <th className="px-3 py-2 font-medium">{k.columns.priority}</th>
                <th className="px-3 py-2 font-medium">{k.columns.due}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((task) => {
                const s = statusOf.get(task.status_id);
                const key = taskKey(project.key, task.number);
                const overdue = task.due_date && task.due_date < today && s?.category !== "done";
                return (
                  <tr key={task.id} className="border-t border-border hover:bg-surface" data-task={key}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{key}</td>
                    <td className="px-3 py-2">
                      <Link href={workspacePath(shortId, `/tasks/${project.key}/${task.number}`)} className={`hover:underline ${s?.category === "done" ? "text-muted line-through" : ""}`}>
                        <span title={k.types[task.type]}>{TYPE_ICONS[task.type]}</span> {task.title}
                      </Link>
                      {task.labels.length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {task.labels.map((label) => (
                            <span key={label} className="rounded bg-surface px-1.5 text-xs text-muted">
                              {label}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${s?.category === "done" ? "bg-emerald-500/15" : s?.category === "doing" ? "bg-sky-500/15" : "bg-surface"}`}>
                        {s?.name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{personLabel(personOf.get(task.assignee_id ?? "")) || <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2" title={k.priorities[task.priority]}>
                      {PRIORITY_ICONS[task.priority]} {k.priorities[task.priority]}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-medium text-danger" : ""}`}>{task.due_date ? shortDate(task.due_date) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
