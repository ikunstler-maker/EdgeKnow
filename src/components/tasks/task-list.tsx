"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { PRIORITY_ICONS, TASK_PRIORITIES, TASK_TYPES, TYPE_ICONS, personLabel, progressOf, taskKey, type Person, type TaskField, type TaskRow, type TaskStatus } from "@/lib/tasks";
import { FilterBar, applyFilters, useFilters } from "./task-filters";
import { bulkUpdateTasks } from "@/app/task-actions";
import { NewTaskDialog } from "./new-task-dialog";
import { DraftCard, useTaskDrafts } from "./task-drafts";
import { TemplatePicker, useTemplates } from "./task-templates";

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
  blocked: blockedList,
  me,
  canEdit,
  isOwner = false,
}: {
  shortId: string;
  project: { id: string; key: string };
  statuses: TaskStatus[];
  tasks: TaskRow[];
  members: Person[];
  fields: TaskField[];
  blocked: string[];
  me: string;
  canEdit: boolean;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const drafts = useTaskDrafts(project.id, tasks);
  const templates = useTemplates(project.id, canEdit);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useFilters(project.id);
  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const today = new Date().toISOString().slice(0, 10);

  const shown = applyFilters(tasks, filters, { me, projectKey: project.key, statuses });
  const labels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels))].sort(), [tasks]);
  const progress = useMemo(() => progressOf(tasks, statuses), [tasks, statuses]);
  const blocked = useMemo(() => new Set(blockedList), [blockedList]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  // Only tasks still shown stay selected.
  const chosen = shown.filter((task) => selected.has(task.id)).map((task) => task.id);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulk = (changes: Record<string, unknown>) =>
    startTransition(async () => {
      const result = await bulkUpdateTasks(chosen, changes);
      if (!result.ok) {
        setNotice(null);
        setError(k.errors[result.error] ?? t.common.unknownError);
      } else {
        setError(null);
        setNotice(k.bulk.done(result.changed));
        if (changes.delete) setSelected(new Set());
      }
      router.refresh();
    });

  return (
    <div className="mt-6">
      {canEdit && (
        <div className="flex gap-2">
          <TemplatePicker templates={templates.templates} chosen={templates.chosen} onPick={templates.pick} />
          <button type="button" onClick={() => setCreating(true)} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white md:min-h-9" data-new-task-open>
            {t.tasks.newTask.open}
          </button>
        </div>
      )}
      {drafts.drafts.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {drafts.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} onRetry={() => drafts.retry(d.id)} onDismiss={() => drafts.dismiss(d.id)} />
          ))}
        </div>
      )}
      {creating && (
        <NewTaskDialog
          onCreate={drafts.create}
          projectId={project.id}
          canAddFields={isOwner}
          statuses={statuses.filter((s) => !s.board_id)}
          statusId={null}
          members={members}
          fields={fields}
          template={templates.chosen}
          onClose={() => setCreating(false)}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <FilterBar filters={filters} setFilters={setFilters} members={members} statuses={statuses} fields={fields} labels={labels} />
      <p className="mt-2 text-xs text-muted">{k.count(shown.length, tasks.length)}</p>
      {canEdit && chosen.length > 0 && (
        <BulkBar
          count={chosen.length}
          statuses={statuses}
          members={members}
          epics={tasks.filter((task) => task.type === "epic")}
          labels={labels}
          projectKey={project.key}
          pending={pending}
          onApply={bulk}
          onClear={() => setSelected(new Set())}
        />
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="mt-6 text-muted">{k.noTasks}</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-muted">{k.nothingFound}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm" data-task-list>
            <thead className="bg-surface text-muted">
              <tr>
                {canEdit && (
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={k.bulk.selectAll}
                      checked={chosen.length === shown.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((task) => task.id)) : new Set())}
                      className="h-5 w-5 md:h-4 md:w-4"
                    />
                  </th>
                )}
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
                  <tr key={task.id} className={`border-t border-border hover:bg-surface ${selected.has(task.id) ? "bg-accent/5" : ""}`} data-task={key}>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={k.bulk.select(key)} checked={selected.has(task.id)} onChange={() => toggle(task.id)} className="h-5 w-5 md:h-4 md:w-4" />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{key}</td>
                    <td className="px-3 py-2">
                      <Link prefetch={false} href={workspacePath(shortId, `/tasks/${project.key}/${task.number}`)} className={`hover:underline ${s?.category === "done" ? "text-muted line-through" : ""}`}>
                        <span title={k.types[task.type]}>{TYPE_ICONS[task.type]}</span> {task.title}
                      </Link>
                      {blocked.has(task.id) && s?.category !== "done" && (
                        <span className="ml-2 text-xs text-danger" title={k.hierarchy.blocked} data-list-blocked>
                          🔒 {k.hierarchy.blockedShort}
                        </span>
                      )}
                      {progress.has(task.id) && (
                        <span className="ml-2 text-xs text-muted" title={k.hierarchy.progress(progress.get(task.id)!.done, progress.get(task.id)!.total)} data-list-progress>
                          ☑ {progress.get(task.id)!.done}/{progress.get(task.id)!.total}
                        </span>
                      )}
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
                      <span className={`rounded px-2 py-0.5 text-xs ${s?.category === "done" ? "bg-emerald-500/15" : s?.category === "doing" ? "bg-sky-500/15" : s?.category === "review" ? "bg-violet-500/15" : "bg-surface"}`}>
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

// Changes for the selected tasks: one choice applies at once.
function BulkBar({
  count,
  statuses,
  members,
  epics,
  labels,
  projectKey,
  pending,
  onApply,
  onClear,
}: {
  count: number;
  statuses: TaskStatus[];
  members: Person[];
  epics: TaskRow[];
  labels: string[];
  projectKey: string;
  pending: boolean;
  onApply: (changes: Record<string, unknown>) => void;
  onClear: () => void;
}) {
  const b = k.bulk;
  const [label, setLabel] = useState("");
  const pick = (placeholder: string, options: { value: string; label: string }[], apply: (value: string) => Record<string, unknown>) => (
    <select
      value=""
      disabled={pending}
      aria-label={placeholder}
      onChange={(e) => e.target.value && onApply(apply(e.target.value === "-" ? "" : e.target.value))}
      className={`${inputClass} max-w-48`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return (
    <div role="toolbar" aria-label={b.label} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2 text-sm" data-bulk-bar>
      <span className="px-1 font-medium">{b.selected(count)}</span>
      {pick(b.status, statuses.map((s) => ({ value: s.id, label: s.name })), (value) => ({ status_id: value }))}
      {pick(b.assignee, [{ value: "-", label: k.unassigned }, ...members.map((m) => ({ value: m.id, label: personLabel(m) }))], (value) => ({ assignee_id: value || null }))}
      {pick(b.priority, TASK_PRIORITIES.map((p) => ({ value: p, label: `${PRIORITY_ICONS[p]} ${k.priorities[p]}` })), (value) => ({ priority: value }))}
      {pick(b.type, TASK_TYPES.map((value) => ({ value, label: `${TYPE_ICONS[value]} ${k.types[value]}` })), (value) => ({ type: value }))}
      {pick(b.epic, [{ value: "-", label: b.noEpic }, ...epics.map((e) => ({ value: e.id, label: `${taskKey(projectKey, e.number)} ${e.title}` }))], (value) => ({ parent_id: value || null }))}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) {
            onApply({ add_label: label.trim() });
            setLabel("");
          }
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={b.addLabel} aria-label={b.addLabel} maxLength={40} className={`${inputClass} w-32`} />
      </form>
      {labels.length > 0 && pick(b.removeLabel, labels.map((l) => ({ value: l, label: l })), (value) => ({ remove_label: value }))}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(b.deleteConfirm(count))) onApply({ delete: true });
        }}
        className="min-h-11 rounded-md px-2 text-danger hover:underline md:min-h-9"
      >
        {b.delete}
      </button>
      <button type="button" onClick={onClear} className="min-h-11 rounded-md px-2 text-muted hover:text-foreground md:min-h-9">
        {b.clear}
      </button>
    </div>
  );
}
