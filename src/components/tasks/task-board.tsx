"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { workspacePath } from "@/lib/paths";
import {
  CARD_FIELDS,
  PRIORITY_ICONS,
  TASK_PRIORITIES,
  TASK_TYPES,
  TYPE_ICONS,
  personLabel,
  taskKey,
  type Person,
  type StatusCategory,
  type TaskField,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";
import { createTask, deleteTaskStatus, saveTaskStatus, updateTask, updateTaskProject } from "@/app/task-actions";
import { FilterBar, applyFilters, useFilters } from "./task-filters";

const k = t.tasks;
const b = t.tasks.board;
const inputClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";
const shortDate = (value: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(value));
type Group = "none" | "assignee" | "priority" | "type";

// The board: one column per status, cards dragged between and within columns
// (the change shows at once and is saved behind it), quick add in a column,
// filters like Jira's, swimlanes, and which fields a card shows.
export function TaskBoard({
  shortId,
  project,
  statuses,
  tasks: initialTasks,
  members,
  fields,
  me,
  canEdit,
  isOwner,
}: {
  shortId: string;
  project: { id: string; key: string; card_fields: string[] };
  statuses: TaskStatus[];
  tasks: TaskRow[];
  members: Person[];
  fields: TaskField[];
  me: string;
  canEdit: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useFilters(project.id);
  const [group, setGroup] = useState<Group>("none");
  const [dragging, setDragging] = useState<string | null>(null);
  const [cardSettings, setCardSettings] = useState(false);
  // The server's answer replaces the local copy whenever the page refreshes.
  const [fromServer, setFromServer] = useState(initialTasks);
  if (fromServer !== initialTasks) {
    setFromServer(initialTasks);
    setTasks(initialTasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const labels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels))].sort(), [tasks]);
  const shown = applyFilters(tasks, filters, { me, projectKey: project.key, statuses });
  const ordered = [...shown].sort((a, b) => a.position - b.position || a.number - b.number);

  const run = (action: () => Promise<ActionResult>, rollback?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        rollback?.();
        setError(k.errors[result.error] ?? t.common.unknownError);
      } else setError(null);
      router.refresh();
    });

  // Swimlanes: rows of the board by assignee, priority or type.
  const lanes: { id: string; label: string; match: (task: TaskRow) => boolean }[] =
    group === "assignee"
      ? [
          ...members
            .filter((m) => tasks.some((task) => task.assignee_id === m.id))
            .map((m) => ({ id: m.id, label: personLabel(m), match: (task: TaskRow) => task.assignee_id === m.id })),
          { id: "none", label: k.unassigned, match: (task: TaskRow) => !task.assignee_id },
        ]
      : group === "priority"
        ? TASK_PRIORITIES.map((p) => ({ id: p, label: `${PRIORITY_ICONS[p]} ${k.priorities[p]}`, match: (task: TaskRow) => task.priority === p }))
        : group === "type"
          ? TASK_TYPES.map((p) => ({ id: p, label: `${TYPE_ICONS[p]} ${k.types[p]}`, match: (task: TaskRow) => task.type === p }))
          : [{ id: "all", label: "", match: () => true }];

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const task = tasks.find((x) => x.id === event.active.id);
    const over = event.over?.data.current as { status: string; before?: string } | undefined;
    if (!task || !over) return;
    // The new place: before the card it was dropped on, or at the end of the column.
    const column = tasks.filter((x) => x.status_id === over.status && x.id !== task.id).sort((a, b) => a.position - b.position);
    let position: number;
    if (over.before) {
      const index = column.findIndex((x) => x.id === over.before);
      const after = column[index];
      const prev = column[index - 1];
      position = after ? (prev ? (prev.position + after.position) / 2 : after.position - 1) : (column.at(-1)?.position ?? 0) + 1;
    } else position = (column.at(-1)?.position ?? 0) + 1;
    if (task.status_id === over.status && Math.abs(task.position - position) < 1e-9) return;
    const before = tasks;
    setTasks(tasks.map((x) => (x.id === task.id ? { ...x, status_id: over.status, position } : x)));
    run(() => updateTask(task.id, { status_id: over.status, position }), () => setTasks(before));
  };

  const cardFields = new Set(project.card_fields);
  const dragged = dragging ? tasks.find((x) => x.id === dragging) : null;

  return (
    <div>
      <FilterBar filters={filters} setFilters={setFilters} members={members} statuses={statuses} fields={fields} labels={labels} showStatus={false} />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-muted">
          {b.group}
          <select value={group} onChange={(e) => setGroup(e.target.value as Group)} className={inputClass}>
            <option value="none">{b.groups.none}</option>
            <option value="assignee">{b.groups.assignee}</option>
            <option value="priority">{b.groups.priority}</option>
            <option value="type">{b.groups.type}</option>
          </select>
        </label>
        <span className="text-xs text-muted">{k.count(shown.length, tasks.length)}</span>
        {isOwner && (
          <button type="button" className={`${buttonClass} ml-auto`} onClick={() => setCardSettings(true)}>
            🗂 {b.cardSettings}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="mt-3 space-y-4" data-task-board>
          {lanes.map((lane) => (
            <section key={lane.id} aria-label={lane.label || b.title}>
              {lane.label && <h3 className="mb-1 text-sm font-medium text-muted">{lane.label}</h3>}
              <div className="flex gap-3 overflow-x-auto pb-2">
                {statuses.map((status, index) => (
                  <BoardColumn
                    key={status.id}
                    lane={lane.id}
                    status={status}
                    index={index}
                    count={statuses.length}
                    statuses={statuses}
                    tasks={ordered.filter((task) => task.status_id === status.id && lane.match(task))}
                    total={tasks.filter((task) => task.status_id === status.id).length}
                    projectId={project.id}
                    canEdit={canEdit}
                    isOwner={isOwner && lane.id === lanes[0].id}
                    showQuickAdd={canEdit && lane.id === lanes[0].id}
                    pending={pending}
                    run={run}
                    render={(task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        href={workspacePath(shortId, `/tasks/${project.key}/${task.number}`)}
                        taskKey={taskKey(project.key, task.number)}
                        status={status}
                        fields={cardFields}
                        customFields={fields.filter((f) => cardFields.has(f.id))}
                        personOf={personOf}
                        canEdit={canEdit}
                      />
                    )}
                  />
                ))}
                {isOwner && lane.id === lanes[0].id && <AddColumn projectId={project.id} run={run} pending={pending} />}
              </div>
            </section>
          ))}
        </div>
        <DragOverlay>
          {dragged && (
            <div className="w-64 rotate-2 rounded-lg border border-accent bg-background p-3 text-sm shadow-xl">
              <span className="font-mono text-xs text-muted">{taskKey(project.key, dragged.number)}</span>
              <p>{dragged.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {cardSettings && (
        <CardSettings
          selected={project.card_fields}
          fields={fields}
          onClose={() => setCardSettings(false)}
          onSave={(next) => {
            setCardSettings(false);
            run(() => updateTaskProject(project.id, { card_fields: next }));
          }}
        />
      )}
    </div>
  );
}

function BoardColumn({
  lane,
  status,
  index,
  count,
  statuses,
  tasks,
  total,
  projectId,
  canEdit,
  isOwner,
  showQuickAdd,
  pending,
  run,
  render,
}: {
  lane: string;
  status: TaskStatus;
  index: number;
  count: number;
  statuses: TaskStatus[];
  tasks: TaskRow[];
  total: number;
  projectId: string;
  canEdit: boolean;
  isOwner: boolean;
  showQuickAdd: boolean;
  pending: boolean;
  run: (action: () => Promise<ActionResult>, rollback?: () => void) => void;
  render: (task: TaskRow) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${lane}:${status.id}`, data: { status: status.id }, disabled: !canEdit });
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const over = status.wip_limit !== null && total > status.wip_limit;
  const move = (direction: -1 | 1) => {
    const other = statuses[index + direction];
    if (!other) return;
    const neighbour = statuses[index + direction * 2];
    const position = neighbour ? (other.position + neighbour.position) / 2 : other.position + direction;
    run(() => saveTaskStatus(projectId, status.id, status.name, status.category, status.wip_limit, position));
  };

  return (
    <div
      ref={setNodeRef}
      data-column={status.name}
      className={`flex w-72 shrink-0 flex-col rounded-lg border p-2 ${isOver ? "border-accent bg-accent/5" : "border-border bg-surface/50"}`}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${status.category === "done" ? "bg-emerald-500" : status.category === "doing" ? "bg-sky-500" : "bg-slate-400"}`} />
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{status.name}</h4>
        <span className={`text-xs ${over ? "font-semibold text-danger" : "text-muted"}`} title={over ? b.overLimit : undefined} data-wip>
          {status.wip_limit !== null ? `${total}/${status.wip_limit}` : total}
        </span>
        {isOwner && (
          <button type="button" aria-label={b.columnMenu(status.name)} aria-expanded={menu} onClick={() => setMenu(!menu)} className="h-8 w-8 rounded text-muted hover:bg-border">
            ⋯
          </button>
        )}
      </div>
      {menu && (
        <ColumnMenu
          status={status}
          statuses={statuses}
          canLeft={index > 0}
          canRight={index < count - 1}
          onMove={move}
          projectId={projectId}
          run={run}
          pending={pending}
          onClose={() => setMenu(false)}
        />
      )}
      <ul className="flex min-h-12 flex-col gap-2">
        {tasks.map((task) => (
          <DropBefore key={task.id} lane={lane} status={status.id} before={task.id}>
            {render(task)}
          </DropBefore>
        ))}
      </ul>
      {showQuickAdd && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = title.trim();
            if (!value) return;
            setTitle("");
            run(() => createTask(projectId, { title: value, status_id: status.id }));
            input.current?.focus();
          }}
        >
          <input
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={b.quickAdd}
            aria-label={b.quickAddIn(status.name)}
            maxLength={300}
            className={`${inputClass} w-full bg-transparent`}
          />
        </form>
      )}
    </div>
  );
}

// Each card is also a drop target: a card dropped on it goes before it.
function DropBefore({ lane, status, before, children }: { lane: string; status: string; before: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `before:${lane}:${before}`, data: { status, before } });
  return (
    <li ref={setNodeRef} className={isOver ? "border-t-2 border-accent pt-1" : ""}>
      {children}
    </li>
  );
}

function BoardCard({
  task,
  href,
  taskKey: key,
  status,
  fields,
  customFields,
  personOf,
  canEdit,
}: {
  task: TaskRow;
  href: string;
  taskKey: string;
  status: TaskStatus;
  fields: Set<string>;
  customFields: TaskField[];
  personOf: Map<string, Person>;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit });
  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due_date && task.due_date < today && status.category !== "done";
  const assignee = personOf.get(task.assignee_id ?? "");
  const reporter = personOf.get(task.reporter_id ?? "");
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-card={key}
      className={`rounded-lg border border-border bg-background p-3 text-sm shadow-sm ${isDragging ? "opacity-40" : ""} ${canEdit ? "cursor-grab" : ""}`}
    >
      <div className="flex items-center gap-1 text-xs text-muted">
        {fields.has("type") && <span title={k.types[task.type]}>{TYPE_ICONS[task.type]}</span>}
        {fields.has("key") && <span className="font-mono">{key}</span>}
        <span className="flex-1" />
        {fields.has("priority") && <span title={k.priorities[task.priority]}>{PRIORITY_ICONS[task.priority]}</span>}
      </div>
      <Link href={href} className={`mt-1 block font-medium hover:underline ${status.category === "done" ? "text-muted line-through" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        {task.title}
      </Link>
      {fields.has("labels") && task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span key={label} className="rounded bg-surface px-1.5 text-xs text-muted">
              {label}
            </span>
          ))}
        </div>
      )}
      {customFields.map((field) => {
        const value = task.custom?.[field.id];
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return null;
        const chosen = (id: unknown) => field.options.find((o) => o.id === id);
        return (
          <div key={field.id} className="mt-1 flex flex-wrap items-center gap-1 text-xs" data-card-field={field.name}>
            <span className="text-muted">{field.name}:</span>
            {field.kind === "select" || field.kind === "multiselect" ? (
              (Array.isArray(value) ? value : [value]).map((id) => (
                <span key={String(id)} className="rounded-full px-2 text-white" style={{ background: chosen(id)?.color ?? "var(--accent)" }}>
                  {chosen(id)?.label}
                </span>
              ))
            ) : field.kind === "color" ? (
              <span className="inline-block h-3 w-6 rounded" style={{ background: String(value) }} />
            ) : field.kind === "checkbox" || field.kind === "toggle" ? (
              <span>{value ? "✓" : "—"}</span>
            ) : field.kind === "person" ? (
              <span>{personLabel(personOf.get(String(value)))}</span>
            ) : (
              <span className="truncate">{String(value)}</span>
            )}
          </div>
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {fields.has("due") && task.due_date && <span className={overdue ? "font-medium text-danger" : ""}>📅 {shortDate(task.due_date)}</span>}
        {fields.has("start") && task.start_date && <span>▶ {shortDate(task.start_date)}</span>}
        {fields.has("estimate") && task.estimate !== null && <span>⏱ {task.estimate}</span>}
        {fields.has("created") && <span title={k.fields.created}>＋ {shortDate(task.created_at)}</span>}
        {fields.has("updated") && <span title={k.fields.updated}>✎ {shortDate(task.updated_at)}</span>}
        {fields.has("reporter") && reporter && <span title={k.fields.reporter}>✍ {personLabel(reporter)}</span>}
        <span className="flex-1" />
        {fields.has("assignee") && (
          <span title={assignee ? personLabel(assignee) : k.unassigned} className="flex h-6 min-w-6 items-center justify-center rounded-full bg-surface px-1 font-medium text-foreground">
            {assignee ? personLabel(assignee).split(/[\s@]/)[0] : "∅"}
          </span>
        )}
      </div>
    </div>
  );
}

function ColumnMenu({
  status,
  statuses,
  canLeft,
  canRight,
  onMove,
  projectId,
  run,
  pending,
  onClose,
}: {
  status: TaskStatus;
  statuses: TaskStatus[];
  canLeft: boolean;
  canRight: boolean;
  onMove: (direction: -1 | 1) => void;
  projectId: string;
  run: (action: () => Promise<ActionResult>) => void;
  pending: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(status.name);
  const [category, setCategory] = useState<StatusCategory>(status.category);
  const [limit, setLimit] = useState(status.wip_limit ? String(status.wip_limit) : "");
  const [moveTo, setMoveTo] = useState(statuses.find((s) => s.id !== status.id)?.id ?? "");
  return (
    <form
      className="mb-2 space-y-2 rounded-md border border-border bg-background p-2 text-sm"
      aria-label={b.columnMenu(status.name)}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveTaskStatus(projectId, status.id, name, category, limit ? Number(limit) : null, null));
        onClose();
      }}
    >
      <label className="flex flex-col gap-1">
        {b.columnName}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        {b.columnGroup}
        <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)} className={inputClass}>
          <option value="todo">{k.categories.todo}</option>
          <option value="doing">{k.categories.doing}</option>
          <option value="done">{k.categories.done}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {b.wipLimit}
        <input type="number" min={1} max={999} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={b.noLimit} className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="min-h-9 rounded-md bg-accent px-3 text-white">
          {t.common.save}
        </button>
        <button type="button" disabled={!canLeft || pending} onClick={() => onMove(-1)} className={buttonClass} aria-label={b.moveLeft}>
          ←
        </button>
        <button type="button" disabled={!canRight || pending} onClick={() => onMove(1)} className={buttonClass} aria-label={b.moveRight}>
          →
        </button>
      </div>
      {statuses.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="text-xs text-muted">{b.deleteMoveTo}</span>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={inputClass} aria-label={b.deleteMoveTo}>
            {statuses
              .filter((s) => s.id !== status.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={pending}
            className={`${buttonClass} text-danger`}
            onClick={() => {
              if (!confirm(b.deleteConfirm(status.name))) return;
              run(() => deleteTaskStatus(status.id, moveTo || null));
              onClose();
            }}
          >
            {b.deleteColumn}
          </button>
        </div>
      )}
    </form>
  );
}

function AddColumn({ projectId, run, pending }: { projectId: string; run: (action: () => Promise<ActionResult>) => void; pending: boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="w-56 shrink-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        run(() => saveTaskStatus(projectId, null, name, "doing", null, null));
        setName("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={b.addColumn} aria-label={b.addColumn} maxLength={40} className={`${inputClass} w-full`} disabled={pending} />
    </form>
  );
}

function CardSettings({ selected, fields, onClose, onSave }: { selected: string[]; fields: TaskField[]; onClose: () => void; onSave: (next: string[]) => void }) {
  const [chosen, setChosen] = useState(new Set(selected));
  const flip = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={b.cardSettings} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl">
        <h2 className="font-semibold">{b.cardSettings}</h2>
        <p className="mt-1 text-sm text-muted">{b.cardSettingsIntro}</p>
        <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
          {CARD_FIELDS.map((id) => (
            <label key={id} className="flex min-h-11 items-center gap-2 md:min-h-9">
              <input type="checkbox" checked={chosen.has(id)} onChange={() => flip(id)} className="h-5 w-5" />
              {b.cardFields[id]}
            </label>
          ))}
          {fields.map((field) => (
            <label key={field.id} className="flex min-h-11 items-center gap-2 md:min-h-9">
              <input type="checkbox" checked={chosen.has(field.id)} onChange={() => flip(field.id)} className="h-5 w-5" />
              🧩 {field.name}
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => onSave([...CARD_FIELDS.filter((id) => chosen.has(id)), ...fields.filter((f) => chosen.has(f.id)).map((f) => f.id)])} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white">
            {t.common.save}
          </button>
          <button type="button" onClick={onClose} className={buttonClass}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
