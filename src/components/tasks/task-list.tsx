"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { PRIORITY_ICONS, TYPE_ICONS, personLabel, taskKey, type Person, type TaskField, type TaskRow, type TaskStatus } from "@/lib/tasks";
import { FilterBar, applyFilters, useFilters } from "./task-filters";
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
  fields,
  me,
  canEdit,
}: {
  shortId: string;
  project: { id: string; key: string };
  statuses: TaskStatus[];
  tasks: TaskRow[];
  members: Person[];
  fields: TaskField[];
  me: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useFilters(project.id);
  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const today = new Date().toISOString().slice(0, 10);

  const shown = applyFilters(tasks, filters, { me, projectKey: project.key, statuses });
  const labels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels))].sort(), [tasks]);

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

      <FilterBar filters={filters} setFilters={setFilters} members={members} statuses={statuses} fields={fields} labels={labels} />
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
