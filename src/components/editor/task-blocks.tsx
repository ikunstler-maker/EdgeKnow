"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { type StatusCategory, type TaskStatus } from "@/lib/tasks";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { Popover } from "@/components/ui/popover";
import { projectStatuses, projectsForEmbed, setTaskStatusFromPage, taskEmbed, type ChipProject, type TaskEmbed } from "@/app/task-wiki-actions";
import { refreshTaskChips, useTaskChip } from "./task-chip-store";
import { TypeIcon } from "@/components/tasks/task-icons";

const w = t.tasks.wiki;
const pillClass =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-px align-baseline text-[0.85em] font-medium leading-snug whitespace-nowrap";
const CATEGORY_CLASS: Record<StatusCategory, string> = {
  todo: "bg-surface text-muted",
  doing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  review: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const taskHref = (shortId: string, key: string) => {
  const [project, number] = key.split("-");
  return workspacePath(shortId, `/tasks/${project}/${number}`);
};

// --- Task chip (inline): only the task id is stored; key, title and status are
// read live with the reader's own access ("no access" otherwise). -------------------

export const taskChip = createReactInlineContentSpec(
  {
    type: "taskChip",
    propSchema: { taskId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <TaskChipView taskId={inlineContent.props.taskId} />,
    toExternalHTML: () => <span>[{w.chipTitle}]</span>,
  },
);

export function TaskChipView({ taskId }: { taskId: string }) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId;
  const task = useTaskChip(shortId, taskId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [statuses, setStatuses] = useState<TaskStatus[] | null>(null);
  const [pending, startTransition] = useTransition();
  if (task === undefined) {
    return (
      <span contentEditable={false} className={`${pillClass} ek-chip bg-surface text-muted`} data-task-chip="loading">
        ✅ …
      </span>
    );
  }
  if (task === null || !shortId) {
    return (
      <span contentEditable={false} className={`${pillClass} ek-chip bg-surface text-muted`} title={w.chipNoAccess} data-task-chip="hidden">
        🔒 {w.chipNoAccess}
      </span>
    );
  }
  return (
    <span contentEditable={false} className="ek-chip" data-task-chip={task.key}>
      <button
        type="button"
        onClick={(event) => {
          setAnchor(anchor ? null : event.currentTarget);
          if (task.canEdit && !statuses) projectStatuses(shortId, task.projectId).then(setStatuses);
        }}
        className={`${pillClass} border border-border bg-background text-foreground hover:bg-surface ${task.deleted ? "line-through opacity-60" : ""}`}
        aria-haspopup="menu"
        title={`${task.key} ${task.title}`}
      >
        <TypeIcon type={task.type} />
        <span className="font-mono text-[0.9em] text-muted">{task.key}</span>
        <span className={`truncate ${task.category === "done" ? "line-through" : ""}`}>{task.title}</span>
        <span className={`rounded-full px-1.5 text-[0.85em] ${CATEGORY_CLASS[task.category]}`} data-task-chip-status>
          {task.deleted ? w.chipDeleted : task.status}
        </span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={240}>
          <div role="menu" aria-label={task.key} className="p-1">
            <Link prefetch={false} href={taskHref(shortId, task.key)} className="flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface md:min-h-9">
              ↗ {w.open}
            </Link>
            {task.canEdit && (
              <>
                <p className="px-3 pb-1 pt-2 text-xs text-muted">{w.changeStatus}</p>
                {(statuses ?? []).map((status) => (
                  <button
                    key={status.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={status.name === task.status}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await setTaskStatusFromPage(shortId, task.id, status.id);
                        refreshTaskChips();
                        setAnchor(null);
                      })
                    }
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface md:min-h-9"
                  >
                    <span className={`rounded-full px-2 text-xs ${CATEGORY_CLASS[status.category]}`}>{status.name}</span>
                    {status.name === task.status && <span className="ml-auto text-accent">✓</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        </Popover>
      )}
    </span>
  );
}

// --- Tasks block: a project's tasks as a list or a board, live ---------------------

export const tasksBlock = createReactBlockSpec(
  {
    type: "tasks",
    propSchema: {
      projectId: { default: "" },
      view: { default: "list", values: ["list", "board"] as const },
      mine: { default: false },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <TasksEmbedView
        projectId={block.props.projectId}
        view={block.props.view}
        mine={block.props.mine}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
    toExternalHTML: () => <p>[{w.embedTitle}]</p>,
  },
);

type EmbedProps = { projectId?: string; view?: "list" | "board"; mine?: boolean };

export function TasksEmbedView({
  projectId,
  view,
  mine,
  editable,
  onChange,
}: {
  projectId: string;
  view: "list" | "board";
  mine: boolean;
  editable: boolean;
  onChange: (props: EmbedProps) => void;
}) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  const [data, setData] = useState<TaskEmbed | null | undefined>(undefined);
  const [projects, setProjects] = useState<ChipProject[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);

  // Read again every 30 seconds while shown, and when the page comes back into view.
  useEffect(() => {
    if (!shortId || !projectId) return;
    let alive = true;
    taskEmbed(shortId, projectId, mine).then((result) => alive && setData(result));
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const timer = setInterval(again, 30_000);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [shortId, projectId, mine, tick]);
  useEffect(() => {
    if (editable && shortId && !projects) projectsForEmbed(shortId).then(setProjects);
  }, [editable, shortId, projects]);

  const setStatus = (taskId: string, statusId: string) =>
    startTransition(async () => {
      await setTaskStatusFromPage(shortId, taskId, statusId);
      setTick((n) => n + 1);
      refreshTaskChips();
    });

  const controls = editable && (
    <div className="flex flex-wrap items-center gap-2 text-sm" contentEditable={false}>
      <select
        value={projectId}
        onChange={(e) => onChange({ projectId: e.target.value })}
        aria-label={w.project}
        className="min-h-9 rounded-md border border-border bg-background px-2"
      >
        <option value="">{w.chooseProject}</option>
        {(projects ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.icon ?? "📋"} {p.name} ({p.key})
          </option>
        ))}
      </select>
      {projectId && (
        <>
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group">
            {(["list", "board"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => onChange({ view: value })}
                className={`min-h-9 px-3 ${view === value ? "bg-accent text-white" : "hover:bg-surface"}`}
              >
                {w[value]}
              </button>
            ))}
          </div>
          <label className="inline-flex min-h-9 items-center gap-1">
            <input type="checkbox" checked={mine} onChange={(e) => onChange({ mine: e.target.checked })} /> {w.onlyMine}
          </label>
        </>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (!projectId) body = editable ? null : <p className="text-sm text-muted">{w.empty}</p>;
  else if (data === undefined) body = <p className="text-sm text-muted" data-export-loading>{w.loading}</p>;
  else if (data === null) body = <p className="text-sm text-muted">{w.noAccess}</p>;
  else {
    const statusOf = new Map(data.statuses.map((s) => [s.id, s]));
    const firstDone = data.statuses.find((s) => s.category === "done");
    const firstTodo = data.statuses.find((s) => s.category === "todo") ?? data.statuses[0];
    const key = (n: number) => `${data.project.key}-${n}`;
    const statusSelect = (task: TaskEmbed["tasks"][number]) =>
      data.canEdit ? (
        <select
          value={task.status_id}
          disabled={pending}
          aria-label={w.statusOf(key(task.number))}
          onChange={(e) => setStatus(task.id, e.target.value)}
          className="min-h-9 max-w-36 rounded-md border border-border bg-background px-1 text-xs"
        >
          {data.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <span className={`rounded-full px-2 text-xs ${CATEGORY_CLASS[statusOf.get(task.status_id)?.category ?? "todo"]}`}>{statusOf.get(task.status_id)?.name}</span>
      );
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {data.project.icon ?? "📋"} {data.project.name}
          </span>
          <span className="text-xs text-muted">{w.shown(data.tasks.length, data.total)}</span>
          <span className="flex-1" />
          <Link prefetch={false} href={workspacePath(shortId, `/tasks/${data.project.key}${view === "list" ? "?view=list" : ""}`)} className="text-sm text-accent hover:underline">
            {w.openInTasks} ↗
          </Link>
        </div>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-muted">{w.empty}</p>
        ) : view === "board" ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.statuses.map((status) => (
              <div key={status.id} className="w-56 shrink-0 rounded-lg bg-surface p-2" data-embed-column={status.name}>
                <p className="mb-1 text-xs font-medium text-muted">
                  {status.name} · {data.tasks.filter((task) => task.status_id === status.id).length}
                </p>
                <div className="space-y-1">
                  {data.tasks
                    .filter((task) => task.status_id === status.id)
                    .map((task) => (
                      <div key={task.id} className="rounded-md border border-border bg-background p-2 text-sm" data-embed-task={key(task.number)}>
                        <Link prefetch={false} href={taskHref(shortId, key(task.number))} className="block hover:underline">
                          <span className="font-mono text-xs text-muted">{key(task.number)}</span> {task.title}
                        </Link>
                        {data.canEdit && <div className="mt-1">{statusSelect(task)}</div>}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.tasks.map((task) => {
              const done = statusOf.get(task.status_id)?.category === "done";
              return (
                <li key={task.id} className="flex min-h-11 items-center gap-2 px-2 text-sm" data-embed-task={key(task.number)}>
                  {data.canEdit && firstDone && (
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={pending}
                      aria-label={w.markDone(task.title)}
                      onChange={() => setStatus(task.id, done ? firstTodo.id : firstDone.id)}
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  <span className="font-mono text-xs text-muted">{key(task.number)}</span>
                  <Link prefetch={false} href={taskHref(shortId, key(task.number))} className={`min-w-0 flex-1 truncate hover:underline ${done ? "text-muted line-through" : ""}`}>
                    <TypeIcon type={task.type} className="mr-1 inline" />
                    {task.title}
                  </Link>
                  {statusSelect(task)}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3" contentEditable={false} data-tasks-embed>
      {controls}
      {body}
    </div>
  );
}
