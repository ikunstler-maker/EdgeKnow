"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import {
  CARD_FIELDS,
  TASK_PRIORITIES,
  TASK_TYPES,
  personLabel,
  progressOf,
  taskKey,
  type Person,
  type StatusCategory,
  type TaskField,
  type TaskPriority,
  type TaskRow,
  type TaskBoardInfo,
  type TaskPlacement,
  type TaskStatus,
} from "@/lib/tasks";
import { addColumnOnBoard, deleteTaskBoard, deleteTaskStatus, moveTaskOnBoard, saveTaskBoard, saveTaskStatus, setColumnFreezes, setFrozenMovesAdmin, updateTask, updateTaskProject } from "@/app/task-actions";
import { FilterBar, applyFilters, useFilters } from "./task-filters";
import { TaskRulesDialog } from "./task-rules";
import { TemplatePicker, useTemplates } from "./task-templates";
import { NewTaskDialog } from "./new-task-dialog";
import { DraftCard, useTaskDrafts } from "./task-drafts";
import { Avatar, PriorityIcon, TypeIcon } from "./task-icons";
import { labelTint } from "./task-pickers";
import { openingTask, useTaskPanelHref } from "./task-panel";
import { Icon } from "@/components/ui/icon";
import { MenuItem, Popover } from "@/components/ui/popover";
import { buttonClass as uiButton, iconButtonClass } from "@/components/ui/button";

const k = t.tasks;
const b = t.tasks.board;
const inputClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base hover:border-border-strong md:h-9 md:min-h-0 md:text-sm";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const shortDate = (value: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(value));
type Group = "none" | "assignee" | "priority" | "type";

// The board: one column per status, cards dragged between and within columns
// (the change shows at once and is saved behind it), quick add in a column,
// filters like Jira's, swimlanes, and which fields a card shows.
export function TaskBoard({
  project,
  statuses: allStatuses,
  boards = [],
  groups = [],
  placements: initialPlacements = [],
  tasks: initialTasks,
  members,
  fields,
  blocked: blockedList,
  me,
  canEdit,
  isOwner,
  initialBoard = null,
}: {
  shortId: string;
  project: { id: string; key: string; card_fields: string[]; time_last_column?: boolean; frozen_moves_admin?: boolean };
  statuses: TaskStatus[];
  boards?: TaskBoardInfo[];
  groups?: { id: string; name: string }[];
  placements?: TaskPlacement[];
  tasks: TaskRow[];
  members: Person[];
  fields: TaskField[];
  blocked: string[];
  me: string;
  canEdit: boolean;
  isOwner: boolean;
  initialBoard?: string | null;
}) {
  const router = useRouter();
  // The board shown (null: the project's main board); columns belong to one board.
  const [boardId, setBoardId] = useState<string | null>(initialBoard);
  // Column positions moved by dragging, shown at once until the page refreshes.
  const [columnMoves, setColumnMoves] = useState<Record<string, number>>({});
  const [newTaskIn, setNewTaskIn] = useState<string | null | undefined>(undefined);
  const statuses = allStatuses
    .filter((s) => (s.board_id ?? null) === (boards.some((x) => x.id === boardId) ? boardId : null))
    .map((s) => (s.id in columnMoves ? { ...s, position: columnMoves[s.id] } : s))
    .sort((a, b) => a.position - b.position);
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useFilters(project.id);
  const [group, setGroup] = useState<Group>("none");
  const [dragging, setDragging] = useState<string | null>(null);
  const [cardSettings, setCardSettings] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const templates = useTemplates(project.id, canEdit);
  const drafts = useTaskDrafts(project.id, initialTasks);
  // The server's answer replaces the local copy whenever the page refreshes.
  const [fromServer, setFromServer] = useState(initialTasks);
  const [placements, setPlacements] = useState(initialPlacements);
  if (fromServer !== initialTasks) {
    setFromServer(initialTasks);
    setTasks(initialTasks);
    setPlacements(initialPlacements);
    setColumnMoves({});
  }
  // A task stands on each board in its own column; where it is frozen for this person
  // only the snapshot arrives (no live row).
  const currentBoard = boards.some((x) => x.id === boardId) ? boardId : null;
  const boardRows: TaskRow[] = placements.length
    ? placements
        .filter((p) => (p.board_id ?? null) === currentBoard)
        .flatMap((p): TaskRow[] => {
          const live = tasks.find((x) => x.id === p.task_id);
          if (live) return [{ ...live, status_id: p.status_id, frozen: !!p.frozen_at }];
          return p.snapshot ? [snapshotRow(p)] : [];
        })
    : tasks;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const labels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels))].sort(), [tasks]);
  const progress = useMemo(() => progressOf(tasks, allStatuses), [tasks, allStatuses]);
  const blocked = useMemo(() => new Set(blockedList), [blockedList]);
  const shown = applyFilters(boardRows, filters, { me, projectKey: project.key, statuses: allStatuses });
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
        ? TASK_PRIORITIES.map((p) => ({ id: p, label: k.priorities[p], match: (task: TaskRow) => task.priority === p }))
        : group === "type"
          ? TASK_TYPES.map((p) => ({ id: p, label: k.types[p], match: (task: TaskRow) => task.type === p }))
          : [{ id: "all", label: "", match: () => true }];

  // closestCorners alone measures to column corners, so a tall column far away loses to the
  // card slots of the column the card came from: prefer whatever is under the pointer or finger.
  const collision: CollisionDetection = (args) => {
    const under = pointerWithin(args);
    if (under.length) {
      const slots = under.filter((hit) => String(hit.id).startsWith("before:"));
      return slots.length ? slots : under;
    }
    return closestCorners(args);
  };

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    if (String(event.active.id).startsWith("col:")) return moveColumn(String(event.active.id).slice(4), (event.over?.data.current as { status?: string } | undefined)?.status);
    const task = boardRows.find((x) => x.id === event.active.id && !x.snapshot);
    const over = event.over?.data.current as { status: string; before?: string } | undefined;
    if (!task || !over) return;
    // The new place: before the card it was dropped on, or at the end of the column.
    const column = boardRows.filter((x) => x.status_id === over.status && x.id !== task.id).sort((a, b) => a.position - b.position);
    let position: number;
    if (over.before) {
      const index = column.findIndex((x) => x.id === over.before);
      const after = column[index];
      const prev = column[index - 1];
      position = after ? (prev ? (prev.position + after.position) / 2 : after.position - 1) : (column.at(-1)?.position ?? 0) + 1;
    } else position = (column.at(-1)?.position ?? 0) + 1;
    if (task.status_id === over.status && Math.abs(task.position - position) < 1e-9) return;
    const before = tasks;
    const beforePlaces = placements;
    const home = (allStatuses.find((x) => x.id === tasks.find((t) => t.id === task.id)?.status_id)?.board_id ?? null) === currentBoard;
    setPlacements(placements.map((p) => (p.task_id === task.id && (p.board_id ?? null) === currentBoard ? { ...p, status_id: over.status } : p)));
    if (home) setTasks(tasks.map((x) => (x.id === task.id ? { ...x, status_id: over.status, position } : x)));
    const undo = () => {
      setTasks(before);
      setPlacements(beforePlaces);
    };
    // Another column: the database places it (rules, freezing); the same column: only the order.
    if (task.status_id !== over.status) run(() => moveTaskOnBoard(task.id, over.status), undo);
    else if (home) run(() => updateTask(task.id, { position }), undo);
  };

  // A column dropped on another takes its place (after it when moving right).
  const moveColumn = (id: string, target: string | undefined) => {
    const from = statuses.findIndex((s) => s.id === id);
    const to = statuses.findIndex((s) => s.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const rest = statuses.filter((s) => s.id !== id);
    const at = rest.findIndex((s) => s.id === target) + (from < to ? 1 : 0);
    const prev = rest[at - 1];
    const next = rest[at];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next.position - 1;
    const status = statuses[from];
    const before = columnMoves;
    setColumnMoves({ ...columnMoves, [id]: position });
    run(() => saveTaskStatus(project.id, status.id, status.name, status.category, status.wip_limit, position), () => setColumnMoves(before));
  };

  const cardFields = new Set(project.card_fields);
  const taskHref = useTaskPanelHref();
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const dragged = dragging ? tasks.find((x) => x.id === dragging) : null;

  return (
    <div>
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        members={members}
        statuses={statuses}
        fields={fields}
        labels={labels}
        showStatus={false}
        trailing={
          <>
            <span className="text-xs text-muted">{k.count(shown.length, tasks.length)}</span>
            <label className="flex items-center gap-1 text-xs text-muted">
              {b.group}
              <select value={group} onChange={(e) => setGroup(e.target.value as Group)} className={inputClass}>
                <option value="none">{b.groups.none}</option>
                <option value="assignee">{b.groups.assignee}</option>
                <option value="priority">{b.groups.priority}</option>
                <option value="type">{b.groups.type}</option>
              </select>
            </label>
            {canEdit && <TemplatePicker templates={templates.templates} chosen={templates.chosen} onPick={templates.pick} />}
            {isOwner && (
              <button type="button" className={iconButtonClass("ghost")} onClick={() => setCardSettings(true)} aria-label={b.cardSettings} title={b.cardSettings}>
                <Icon name="layers" size={18} />
              </button>
            )}
            {isOwner && (
              <button type="button" className={iconButtonClass("ghost")} onClick={() => setRulesOpen(true)} aria-label={t.notifications.rules.button} title={t.notifications.rules.button} data-open-rules>
                <Icon name="bell" size={18} />
              </button>
            )}
            {isOwner && (
              <button type="button" className={iconButtonClass("ghost")} onClick={(e) => setSettingsAnchor(settingsAnchor ? null : e.currentTarget)} aria-label={b.settings} title={b.settings} aria-expanded={settingsAnchor !== null} data-board-settings>
                <Icon name="columns" size={18} />
              </button>
            )}
            {canEdit && statuses.length > 0 && (
              <button type="button" className={uiButton("primary")} onClick={() => setNewTaskIn(statuses[0].id)} data-new-task-top>
                <Icon name="plus" />
                {t.tasks.newTask.title}
              </button>
            )}
          </>
        }
      />
      {settingsAnchor && (
        <Popover anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} width={320}>
          <div className="space-y-1 p-2 text-sm" data-board-settings-panel>
            <label className="flex min-h-11 items-center gap-2 md:min-h-9">
              <input
                type="checkbox"
                checked={project.time_last_column === true}
                disabled={pending}
                onChange={(e) => run(() => updateTaskProject(project.id, { time_last_column: e.target.checked }))}
                data-time-last-column
              />
              {k.columnTime.countLast}
            </label>
            {boards.length > 0 && (
              <label className="flex min-h-11 items-center gap-2 md:min-h-9">
                <input
                  type="checkbox"
                  checked={project.frozen_moves_admin !== false}
                  disabled={pending}
                  onChange={(e) => run(() => setFrozenMovesAdmin(project.id, e.target.checked))}
                  data-frozen-admin
                />
                {t.tasks.boards.frozenAdminOnly}
              </label>
            )}
          </div>
        </Popover>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <BoardTabs
        boards={boards}
        groups={groups}
        boardId={boardId}
        onPick={setBoardId}
        isOwner={isOwner}
        pending={pending}
        onSave={(id, name, groupId, extra) => run(() => saveTaskBoard(project.id, id, name, groupId, extra))}
        onRemove={(id) => {
          const target = allStatuses.find((s) => !s.board_id);
          if (!target || !confirm(t.tasks.boards.removeConfirm)) return;
          setBoardId(null);
          run(() => deleteTaskBoard(id, target.id));
        }}
      />
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="mt-3 space-y-4" data-task-board>
          {lanes.map((lane) => (
            <section key={lane.id} aria-label={lane.label || b.title}>
              {lane.label && <h3 className="mb-1 text-sm font-medium text-muted">{lane.label}</h3>}
              <ScrollRow>
                {statuses.map((status, index) => (
                  <BoardColumn
                    key={status.id}
                    lane={lane.id}
                    status={status}
                    index={index}
                    count={statuses.length}
                    statuses={statuses}
                    tasks={ordered.filter((task) => task.status_id === status.id && lane.match(task))}
                    total={boardRows.filter((task) => task.status_id === status.id).length}
                    projectId={project.id}
                    canEdit={canEdit}
                    isOwner={isOwner && lane.id === lanes[0].id}
                    showQuickAdd={canEdit && lane.id === lanes[0].id}
                    onNewTask={() => setNewTaskIn(status.id)}
                    drafts={lane.id === lanes[0].id ? drafts.drafts.filter((d) => (d.fields.status_id ?? statuses[0]?.id) === status.id).map((d) => (
                      <DraftCard key={d.id} draft={d} onRetry={() => drafts.retry(d.id)} onDismiss={() => drafts.dismiss(d.id)} />
                    )) : null}
                    pending={pending}
                    run={run}
                    render={(task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        href={taskHref(task.number)}
                        taskKey={taskKey(project.key, task.number)}
                        status={status}
                        fields={cardFields}
                        customFields={fields.filter((f) => cardFields.has(f.id))}
                        personOf={personOf}
                        members={members}
                        progress={progress.get(task.id)}
                        blocked={blocked.has(task.id)}
                        canEdit={canEdit}
                        onPriority={(priority) => {
                          const before = tasks;
                          setTasks(tasks.map((x) => (x.id === task.id ? { ...x, priority } : x)));
                          run(() => updateTask(task.id, { priority }), () => setTasks(before));
                        }}
                        onAssignee={(assignee_id) => {
                          const before = tasks;
                          setTasks(tasks.map((x) => (x.id === task.id ? { ...x, assignee_id } : x)));
                          run(() => updateTask(task.id, { assignee_id }), () => setTasks(before));
                        }}
                      />
                    )}
                  />
                ))}
                {isOwner && lane.id === lanes[0].id && <AddColumn projectId={project.id} boardId={boards.some((x) => x.id === boardId) ? boardId : null} run={run} pending={pending} />}
              </ScrollRow>
            </section>
          ))}
        </div>
        <DragOverlay>
          {dragged && (
            <div className="w-64 rotate-2 rounded-xl border border-accent bg-background p-2.5 text-sm shadow-2xl">
              <span className="font-mono text-xs text-muted">{taskKey(project.key, dragged.number)}</span>
              <p>{dragged.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {newTaskIn !== undefined && (
        <NewTaskDialog onCreate={drafts.create} projectId={project.id} canAddFields={isOwner} statuses={statuses} statusId={newTaskIn} members={members} fields={fields} template={templates.chosen} onClose={() => setNewTaskIn(undefined)} />
      )}
      {rulesOpen && <TaskRulesDialog projectId={project.id} statuses={allStatuses} boards={boards} members={members} onClose={() => setRulesOpen(false)} />}
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

// The row of columns scrolls sideways; an arrow on an edge says there are more columns
// that way (and scrolls to them), so the first columns can't hide unnoticed.
function ScrollRow({ children }: { children: React.ReactNode }) {
  const [more, setMore] = useState({ left: false, right: false });
  const row = useRef<HTMLDivElement | null>(null);
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const next = { left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 };
    setMore((before) => (before.left === next.left && before.right === next.right ? before : next));
  };
  const attach = (el: HTMLDivElement | null) => {
    row.current = el;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  };
  const arrow = (side: "left" | "right") => (
    <button
      type="button"
      onClick={() => row.current?.scrollBy({ left: (side === "left" ? -1 : 1) * Math.max(288, row.current.clientWidth * 0.7), behavior: "smooth" })}
      aria-label={side === "left" ? b.scrollLeft : b.scrollRight}
      title={side === "left" ? b.scrollLeft : b.scrollRight}
      className={`absolute top-1 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-overlay text-foreground shadow-lg hover:bg-hover md:h-8 md:w-8 ${side === "left" ? "left-1" : "right-1"}`}
      data-board-scroll={side}
    >
      <Icon name={side === "left" ? "chevron-left" : "chevron-right"} size={18} />
    </button>
  );
  return (
    <div className="relative">
      <div ref={attach} onScroll={measure} className="flex gap-3 overflow-x-auto pb-2">
        {children}
      </div>
      {more.left && arrow("left")}
      {more.right && arrow("right")}
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
  onNewTask,
  drafts,
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
  onNewTask: () => void;
  drafts: React.ReactNode;
  pending: boolean;
  run: (action: () => Promise<ActionResult>, rollback?: () => void) => void;
  render: (task: TaskRow) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${lane}:${status.id}`, data: { status: status.id }, disabled: !canEdit });
  const [menu, setMenu] = useState(false);
  const handle = useDraggable({ id: `col:${status.id}`, disabled: !isOwner || pending });
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
      ref={(node) => {
        setNodeRef(node);
        handle.setNodeRef(node);
      }}
      data-column={status.name}
      style={handle.transform ? { transform: `translate3d(${handle.transform.x}px, ${handle.transform.y}px, 0)` } : undefined}
      className={`flex w-72 shrink-0 flex-col rounded-xl border p-2 ${handle.isDragging ? "relative z-20 border-accent bg-background shadow-xl" : isOver ? "border-accent bg-accent/5" : "border-transparent bg-surface"}`}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        {isOwner && (
          <button type="button" {...handle.listeners} {...handle.attributes} aria-label={b.dragColumn(status.name)} className="-ml-1 flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-hover" data-column-handle>
            <Icon name="drag" size={14} />
          </button>
        )}
        <span className={`h-2 w-2 shrink-0 rounded-full ${status.category === "done" ? "bg-emerald-500" : status.category === "doing" ? "bg-sky-500" : status.category === "review" ? "bg-violet-500" : "bg-slate-400"}`} />
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{status.name}</h4>
        <span className={`text-xs ${over ? "font-semibold text-danger" : "text-muted"}`} title={over ? b.overLimit : undefined} data-wip>
          {status.wip_limit !== null ? `${total}/${status.wip_limit}` : total}
        </span>
        {isOwner && (
          <button type="button" aria-label={b.columnMenu(status.name)} aria-expanded={menu} onClick={() => setMenu(!menu)} className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-hover">
            <Icon name="more" />
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
      {drafts && <div className="mt-2 flex flex-col gap-2">{drafts}</div>}
      {showQuickAdd && (
        <button type="button" onClick={onNewTask} aria-label={t.tasks.newTask.openIn(status.name)} className="mt-2 flex min-h-11 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm text-muted hover:bg-hover hover:text-foreground md:min-h-8" data-new-task-open>
          <Icon name="plus" />
          {t.tasks.newTask.title}
        </button>
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
  members,
  progress,
  blocked,
  canEdit,
  onPriority,
  onAssignee,
}: {
  task: TaskRow;
  href: string;
  taskKey: string;
  status: TaskStatus;
  fields: Set<string>;
  customFields: TaskField[];
  personOf: Map<string, Person>;
  members: Person[];
  progress?: { done: number; total: number };
  blocked: boolean;
  canEdit: boolean;
  onPriority?: (priority: TaskPriority) => void;
  onAssignee?: (assignee: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit || !!task.snapshot });
  // The priority mark and the avatar open a small list to change them in place.
  const [menu, setMenu] = useState<{ kind: "priority" | "assignee"; anchor: HTMLElement } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due_date && task.due_date < today && status.category !== "done";
  const assignee = personOf.get(task.assignee_id ?? "");
  const reporter = personOf.get(task.reporter_id ?? "");
  const editable = canEdit && !task.snapshot;
  // A control on a draggable card: its own presses must not start a drag.
  const own = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };
  const hit = "-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-hover md:my-0 md:h-6 md:w-6";
  const open = (kind: "priority" | "assignee") => (e: React.MouseEvent<HTMLElement>) => setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget });
  const assigneeName = assignee ? personLabel(assignee) : k.unassigned;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-card={key}
      className={`rounded-xl border border-border bg-background p-2.5 text-sm transition-colors hover:border-border-strong ${isDragging ? "opacity-40" : ""} ${canEdit ? "cursor-grab" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {fields.has("key") && <span className="font-mono">{key}</span>}
        <span className="flex-1" />
        {task.frozen && (
          <span title={task.snapshot ? t.tasks.boards.snapshotHint : t.tasks.boards.frozenHint} aria-label={t.tasks.boards.frozen} role="img" data-card-frozen>
            <Icon name="snow" size={14} />
          </span>
        )}
        {task.private && (
          <span title={k.privacy.privateHint} aria-label={k.privacy.private} role="img" data-card-private>
            <Icon name="lock" size={14} />
          </span>
        )}
        {blocked && status.category !== "done" && (
          <span title={k.hierarchy.blocked} aria-label={k.hierarchy.blockedShort} role="img" className="text-danger" data-card-blocked>
            <Icon name="alert" size={14} />
          </span>
        )}
        {fields.has("priority") &&
          (editable && onPriority ? (
            <button type="button" {...own} onClick={open("priority")} aria-label={`${b.cardFields.priority}: ${k.priorities[task.priority]} · ${key}`} title={`${b.cardFields.priority}: ${k.priorities[task.priority]}`} aria-expanded={menu?.kind === "priority"} className={hit} data-card-priority={task.priority}>
              <PriorityIcon priority={task.priority} size={16} />
            </button>
          ) : (
            <span title={`${b.cardFields.priority}: ${k.priorities[task.priority]}`} aria-label={`${b.cardFields.priority}: ${k.priorities[task.priority]}`} role="img" data-card-priority={task.priority}>
              <PriorityIcon priority={task.priority} size={16} />
            </span>
          ))}
      </div>
      {/* Opens over the board; the address changes, so the link can be shared and "Back" closes it. */}
      <Link
        prefetch={false}
        scroll={false}
        href={href}
        className={`mt-1 block text-sm font-medium leading-snug hover:underline ${status.category === "done" ? "text-muted" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) openingTask(task.number);
        }}
        data-card-open
      >
        {task.title}
      </Link>
      {/* What "What to show on the card" chose, as compact marks; a field with nothing in it takes no room. */}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted" data-card-fields>
        {fields.has("type") && (
          <CardChip label={b.cardFields.type}>
            <TypeIcon type={task.type} size={12} />
            {k.types[task.type]}
          </CardChip>
        )}
        {fields.has("due") && task.due_date && (
          <CardChip label={b.cardFields.due} className={overdue ? "bg-danger/10 font-medium text-danger" : ""}>
            <Icon name="calendar" size={12} />
            {shortDate(task.due_date)}
          </CardChip>
        )}
        {fields.has("start") && task.start_date && (
          <CardChip label={b.cardFields.start} data={b.cardFields.start}>
            <Icon name="play" size={12} />
            {shortDate(task.start_date)}
          </CardChip>
        )}
        {fields.has("estimate") && task.estimate !== null && (
          <CardChip label={b.cardFields.estimate}>
            <Icon name="clock" size={12} />
            {task.estimate} {k.hoursShort}
          </CardChip>
        )}
        {(fields.has("subtasks") || task.type === "epic") && progress && (
          <CardChip label={k.hierarchy.progress(progress.done, progress.total)} className={progress.done === progress.total ? "text-emerald-600 dark:text-emerald-400" : ""}>
            <Icon name="subtask" size={12} />
            <span data-card-progress>
              {progress.done}/{progress.total}
            </span>
          </CardChip>
        )}
        {fields.has("labels") &&
          task.labels.map((label) => (
            <CardChip key={label} label={b.cardFields.labels} className={`font-medium ${labelTint(label)}`}>
              {label}
            </CardChip>
          ))}
        {customFields.map((field) => {
          const value = task.custom?.[field.id];
          const empty = value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && !value.length);
          if (empty) return null;
          const chosen = (id: unknown) => field.options.find((o) => o.id === id);
          return (
            <CardChip key={field.id} label={field.name} data={field.name} bare={field.kind === "select" || field.kind === "multiselect"}>
              {field.kind === "select" || field.kind === "multiselect" ? (
                (Array.isArray(value) ? value : [value]).map((id) => (
                  <span key={String(id)} className="rounded-md px-1.5 py-0.5 text-white" style={{ background: chosen(id)?.color ?? "var(--accent)" }}>
                    {chosen(id)?.label}
                  </span>
                ))
              ) : field.kind === "color" ? (
                <span className="inline-block h-3 w-5 rounded" style={{ background: String(value) }} />
              ) : field.kind === "checkbox" || field.kind === "toggle" ? (
                <>
                  <Icon name="check" size={12} />
                  {field.name}
                </>
              ) : field.kind === "person" ? (
                personLabel(personOf.get(String(value)))
              ) : (
                String(value)
              )}
            </CardChip>
          );
        })}
        {fields.has("reporter") && reporter && (
          <CardChip label={b.cardFields.reporter} data={b.cardFields.reporter}>
            <Icon name="edit" size={12} />
            {personLabel(reporter)}
          </CardChip>
        )}
        {fields.has("created") && (
          <CardChip label={b.cardFields.created}>
            <Icon name="history" size={12} />
            {shortDate(task.created_at)}
          </CardChip>
        )}
        {fields.has("updated") && (
          <CardChip label={b.cardFields.updated}>
            <Icon name="refresh" size={12} />
            {shortDate(task.updated_at)}
          </CardChip>
        )}
        <span className="flex-1" />
        {fields.has("assignee") &&
          (editable && onAssignee ? (
            <button type="button" {...own} onClick={open("assignee")} aria-label={`${b.cardFields.assignee}: ${assigneeName} · ${key}`} title={`${b.cardFields.assignee}: ${assigneeName}`} aria-expanded={menu?.kind === "assignee"} className={`${hit} rounded-full`} data-card-assignee>
              <Avatar person={assignee} />
            </button>
          ) : (
            <span title={`${b.cardFields.assignee}: ${assigneeName}`} aria-label={`${b.cardFields.assignee}: ${assigneeName}`} role="img" data-card-assignee>
              <Avatar person={assignee} />
            </span>
          ))}
      </div>
      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={menu.kind === "priority" ? 200 : 240}>
          <div {...own} role="menu" aria-label={menu.kind === "priority" ? b.cardFields.priority : b.cardFields.assignee} data-card-menu={menu.kind}>
            {menu.kind === "priority"
              ? TASK_PRIORITIES.map((p) => (
                  <MenuItem
                    key={p}
                    onSelect={() => {
                      setMenu(null);
                      if (p !== task.priority) onPriority?.(p);
                    }}
                  >
                    <span className="flex flex-1 items-center gap-2" data-priority-option={p}>
                      <PriorityIcon priority={p} size={16} />
                      {k.priorities[p]}
                    </span>
                    {p === task.priority && <Icon name="check" className="text-accent" />}
                  </MenuItem>
                ))
              : [null, ...members].map((person) => (
                  <MenuItem
                    key={person?.id ?? "none"}
                    onSelect={() => {
                      setMenu(null);
                      if ((person?.id ?? null) !== (task.assignee_id ?? null)) onAssignee?.(person?.id ?? null);
                    }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2" data-assignee-option={person?.id ?? "none"}>
                      <Avatar person={person ?? undefined} />
                      <span className="truncate">{person ? personLabel(person) : k.unassigned}</span>
                    </span>
                    {(person?.id ?? null) === (task.assignee_id ?? null) && <Icon name="check" className="text-accent" />}
                  </MenuItem>
                ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

// One piece of a card's metadata; its name shows as a hint and is read aloud.
function CardChip({ label, data, bare = false, className = "", children }: { label: string; data?: string; bare?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span title={label} aria-label={label} data-card-field={data} className={`inline-flex max-w-full items-center gap-1 ${bare ? "" : "rounded-md bg-hover px-1.5 py-0.5"} ${className}`}>
      {children}
    </span>
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
  const [freezes, setFreezes] = useState(!!status.freezes);
  const [moveTo, setMoveTo] = useState(statuses.find((s) => s.id !== status.id)?.id ?? "");
  return (
    <form
      className="mb-2 space-y-2 rounded-md border border-border bg-background p-2 text-sm"
      aria-label={b.columnMenu(status.name)}
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const saved = await saveTaskStatus(projectId, status.id, name, category, limit ? Number(limit) : null, null);
          return saved.ok && freezes !== !!status.freezes ? setColumnFreezes(status.id, status.board_id ?? null, freezes) : saved;
        });
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
          <option value="review">{k.categories.review}</option>
          <option value="done">{k.categories.done}</option>
        </select>
      </label>
      <label className="flex items-start gap-2" title={t.tasks.boards.freezesHint}>
        <input type="checkbox" checked={freezes} onChange={(e) => setFreezes(e.target.checked)} className="mt-1" data-column-freezes />
        <span>
          <Icon name="snow" className="mr-1 inline" />
          {t.tasks.boards.freezes}
          <span className="block text-xs text-muted">{t.tasks.boards.freezesHint}</span>
        </span>
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
          <Icon name="arrow-left" />
        </button>
        <button type="button" disabled={!canRight || pending} onClick={() => onMove(1)} className={buttonClass} aria-label={b.moveRight}>
          <Icon name="arrow-right" />
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

// A new column: a small "+" at the end of the row; the name is asked only when it is pressed.
function AddColumn({ projectId, boardId, run, pending }: { projectId: string; boardId: string | null; run: (action: () => Promise<ActionResult>) => void; pending: boolean }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return (
      <button type="button" onClick={() => setName("")} aria-label={b.addColumn} title={b.addColumn} className={`${iconButtonClass("subtle")} mt-1`} data-add-column>
        <Icon name="plus" size={18} />
      </button>
    );
  }
  return (
    <form
      className="w-56 shrink-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) run(() => addColumnOnBoard(projectId, boardId, name));
        setName(null);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setName(null)}
        onKeyDown={(e) => e.key === "Escape" && setName(null)}
        placeholder={b.addColumn}
        aria-label={b.addColumn}
        maxLength={40}
        className={`${inputClass} w-full`}
        disabled={pending}
      />
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={b.cardSettings} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl border border-border-strong bg-overlay p-5 shadow-2xl sm:rounded-2xl">
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
              {field.name}
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

// Tabs: the project's main board and the teams' boards; the owner adds and removes boards.
function BoardTabs({
  boards,
  groups,
  boardId,
  onPick,
  isOwner,
  pending,
  onSave,
  onRemove,
}: {
  boards: TaskBoardInfo[];
  groups: { id: string; name: string }[];
  boardId: string | null;
  onPick: (id: string | null) => void;
  isOwner: boolean;
  pending: boolean;
  onSave: (id: string | null, name: string, groupId: string | null, extra: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const bt = t.tasks.boards;
  // null: closed; "new": adding; a board id: editing that board's name and access.
  const [editing, setEditing] = useState<string | null>(null);
  const adding = editing !== null;
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const open = (board: TaskBoardInfo | null) => {
    setEditing(board?.id ?? "new");
    setName(board?.name ?? "");
    setGroupId(board?.group_id ?? "");
    setExtra(board?.access ?? []);
  };
  if (!boards.length && !isOwner) return null;
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;
  const tab = (id: string | null, label: string) => (
    <button
      key={id ?? "main"}
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={boardId === id}
      className={`min-h-11 rounded-md px-3 text-sm md:min-h-9 ${boardId === id ? "bg-surface font-medium" : "text-muted hover:text-foreground"}`}
      data-board-tab={label}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-border pb-1" data-board-tabs>
      {tab(null, bt.main)}
      {boards.map((board) => tab(board.id, groupName(board.group_id) ? `${board.name} · ${groupName(board.group_id)}` : board.name))}
      {isOwner && boardId && !adding && (
        <button type="button" onClick={() => open(boards.find((x) => x.id === boardId) ?? null)} className="min-h-11 px-2 text-xs text-muted hover:text-foreground hover:underline md:min-h-9" data-board-access>
          {bt.editAccess}
        </button>
      )}
      {isOwner && boardId && (
        <button type="button" disabled={pending} onClick={() => onRemove(boardId)} className="min-h-11 px-2 text-xs text-danger hover:underline md:min-h-9">
          {bt.remove}
        </button>
      )}
      {isOwner &&
        (adding ? (
          <form
            className="flex flex-wrap items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onSave(editing === "new" ? null : editing, name.trim(), groupId || null, extra.filter((g) => g !== groupId));
              setEditing(null);
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={bt.name} aria-label={bt.name} className={inputClass} autoFocus data-board-name />
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={bt.team} className={inputClass}>
              <option value="">{bt.noTeam}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {groups.length > 0 && (
              <select
                multiple
                value={extra}
                onChange={(e) => setExtra([...e.target.selectedOptions].map((o) => o.value))}
                aria-label={bt.access}
                title={bt.access}
                className={`${inputClass} min-h-16`}
                data-board-extra
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" disabled={pending} className={buttonClass} data-board-save>
              {t.common.save}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => open(null)} className="min-h-11 px-2 text-sm text-muted hover:text-foreground md:min-h-9" data-board-add>
            <Icon name="plus" className="mr-1 inline" />
            {bt.add}
          </button>
        ))}
    </div>
  );
}

// A card from a snapshot: the task as it was when it froze on this board.
function snapshotRow(p: TaskPlacement): TaskRow {
  const s = (p.snapshot ?? {}) as Partial<TaskRow>;
  return {
    id: p.task_id,
    number: s.number ?? 0,
    title: s.title ?? "",
    status_id: p.status_id,
    type: s.type ?? "task",
    priority: s.priority ?? "medium",
    assignee_id: s.assignee_id ?? null,
    reporter_id: s.reporter_id ?? null,
    labels: s.labels ?? [],
    start_date: s.start_date ?? null,
    due_date: s.due_date ?? null,
    estimate: s.estimate ?? null,
    parent_id: null,
    position: 0,
    created_at: p.frozen_at ?? "",
    updated_at: p.frozen_at ?? "",
    done_at: null,
    custom: (s.custom as Record<string, unknown>) ?? {},
    frozen: true,
    snapshot: true,
  };
}
