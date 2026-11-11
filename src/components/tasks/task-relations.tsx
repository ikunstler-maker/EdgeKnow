"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { workspacePath } from "@/lib/paths";
import { taskKey, type LinkKind, type LinkedTask, type TaskRow, type TaskStatus } from "@/lib/tasks";
import { addTaskLink, checklistToSubtasks, createTask, deleteTaskLink, updateTask } from "@/app/task-actions";
import { searchTasksForChip, type ChipTask } from "@/app/task-wiki-actions";
import { TaskPicker } from "./task-pickers";
import { Icon } from "@/components/ui/icon";
import { TypeIcon } from "./task-icons";

const k = t.tasks;
const h = t.tasks.hierarchy;
const inputClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base hover:border-border-strong md:h-9 md:min-h-0 md:text-sm";

export type ProjectTask = Pick<TaskRow, "id" | "number" | "title" | "status_id" | "parent_id" | "type">;
export type TaskLinkView = { id: string; kind: LinkKind; outgoing: boolean; other: LinkedTask };

const linkHref = (shortId: string, key: string) => {
  const [projectKey, number] = key.split("-");
  return workspacePath(shortId, `/tasks/${projectKey}/${number}`);
};

// The tasks below a task and all of their children (a task can't move under them).
function descendantsOf(id: string, tasks: ProjectTask[]) {
  const found = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const task of tasks) {
      if (task.parent_id && found.has(task.parent_id) && !found.has(task.id)) {
        found.add(task.id);
        grew = true;
      }
    }
  }
  return found;
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const run = <T extends object>(action: () => Promise<ActionResult<T>>, onOk?: (result: T) => string | void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        const text = onOk?.(result);
        setMessage(text ? { error: false, text } : null);
      } else setMessage({ error: true, text: k.errors[result.error] ?? t.common.unknownError });
      router.refresh();
    });
  return { pending, run, message };
}

function Message({ message }: { message: { error: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.error ? "alert" : "status"} className={`mt-2 text-sm ${message.error ? "text-danger" : "text-muted"}`}>
      {message.text}
    </p>
  );
}

// The parent (an epic or any other task of the project), found by its key or title.
export function ParentPicker({ task, tasks, canEdit, projectKey }: { task: ProjectTask; tasks: ProjectTask[]; canEdit: boolean; projectKey: string }) {
  const { pending, run, message } = useRun();
  const options = useMemo(() => {
    const below = descendantsOf(task.id, tasks);
    return tasks
      .filter((other) => !below.has(other.id))
      .sort((a, b) => Number(b.type === "epic") - Number(a.type === "epic") || b.number - a.number);
  }, [task.id, tasks]);
  return (
    <>
      <TaskPicker
        label={h.parent}
        projectKey={projectKey}
        options={options}
        value={task.parent_id}
        empty={h.noParent}
        disabled={!canEdit || pending}
        onChange={(id) => run(() => updateTask(task.id, { parent_id: id }))}
      />
      <Message message={message} />
    </>
  );
}

// "Blocked" notice at the top of a task.
export function BlockedNotice({ links }: { links: TaskLinkView[] }) {
  const blockers = links.filter((l) => l.kind === "blocks" && !l.outgoing && !l.other.deleted && l.other.done !== true);
  if (!blockers.length) return null;
  return (
    <p className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm" data-blocked-notice>
      <Icon name="lock" className="mr-1 inline" />
      {h.blocked}: {blockers.map((l) => l.other.key ?? h.hidden).join(", ")}
    </p>
  );
}

// Subtasks (or the tasks of an epic) with progress, quick add and the checklist.
export function Subtasks({
  shortId,
  projectId,
  projectKey,
  task,
  tasks,
  statuses,
  canEdit,
  hrefFor,
}: {
  shortId: string;
  projectId: string;
  projectKey: string;
  task: ProjectTask;
  tasks: ProjectTask[];
  statuses: TaskStatus[];
  canEdit: boolean;
  // Where a subtask opens (the panel over the board keeps it in the panel).
  hrefFor?: (number: number) => string;
}) {
  const { pending, run, message } = useRun();
  const [title, setTitle] = useState("");
  const children = tasks.filter((other) => other.parent_id === task.id).sort((a, b) => a.number - b.number);
  const statusOf = new Map(statuses.map((s) => [s.id, s]));
  const firstOf = (category: string) => statuses.filter((s) => s.category === category).sort((a, b) => a.position - b.position)[0];
  const done = children.filter((c) => statusOf.get(c.status_id)?.category === "done").length;
  const heading = task.type === "epic" ? h.epicTasks : h.subtasks;
  return (
    <section className="mt-6" aria-label={heading} data-subtasks>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-muted">{heading}</h2>
        {children.length > 0 && (
          <>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={children.length} aria-valuenow={done} aria-label={h.progress(done, children.length)}>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / children.length) * 100}%` }} />
            </div>
            <span className="text-xs text-muted" data-progress>
              {h.progress(done, children.length)}
            </span>
          </>
        )}
      </div>
      {children.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{h.noSubtasks}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {children.map((child) => {
            const status = statusOf.get(child.status_id);
            const isDone = status?.category === "done";
            const target = isDone ? firstOf("todo") ?? firstOf("doing") : firstOf("done");
            return (
              <li key={child.id} className="flex min-h-11 items-center gap-2 px-3 text-sm" data-subtask={taskKey(projectKey, child.number)}>
                <input
                  type="checkbox"
                  checked={isDone}
                  disabled={!canEdit || pending || !target}
                  aria-label={h.markDone(child.title)}
                  onChange={() => target && run(() => updateTask(child.id, { status_id: target.id }))}
                  className="h-5 w-5 shrink-0 md:h-4 md:w-4"
                />
                <span className="font-mono text-xs text-muted">{taskKey(projectKey, child.number)}</span>
                <Link prefetch={false} scroll={!hrefFor} href={hrefFor?.(child.number) ?? workspacePath(shortId, `/tasks/${projectKey}/${child.number}`)} className={`min-w-0 flex-1 truncate hover:underline ${isDone ? "text-muted line-through" : ""}`}>
                  <TypeIcon type={child.type} className="mr-1 inline" />
                  {child.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{status?.name}</span>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2">
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = title.trim();
              if (value) run(() => createTask(projectId, { title: value, parent_id: task.id }), () => setTitle(""));
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={h.addSubtask} aria-label={h.addSubtask} maxLength={300} className={`${inputClass} min-w-0 flex-1`} />
          </form>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => checklistToSubtasks(task.id), (r) => (r.created ? h.checklistDone(r.created) : h.checklistNone))}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            {h.checklist}
          </button>
        </div>
      )}
      <Message message={message} />
    </section>
  );
}

const ADD_KINDS = ["blocks", "blocked_by", "relates", "duplicates"] as const;

// Links with other tasks (in any project of the workspace the reader can see).
export function TaskLinks({ shortId, taskId, links, canEdit }: { shortId: string; taskId: string; links: TaskLinkView[]; canEdit: boolean }) {
  const { pending, run, message } = useRun();
  const [kind, setKind] = useState<(typeof ADD_KINDS)[number]>("relates");
  const [key, setKey] = useState("");
  // Tasks offered while typing: by key or by words of the title, across the workspace.
  const [found, setFound] = useState<{ query: string; tasks: ChipTask[] } | null>(null);
  const query = key.trim();
  useEffect(() => {
    if (query.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void searchTasksForChip(shortId, query).then((r) => live && setFound({ query, tasks: r.tasks.filter((x) => x.id !== taskId) }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, shortId, taskId]);
  const offers = found && found.query === query && query.length >= 2 ? found.tasks : [];
  const link = (other: string) => run(() => addTaskLink(taskId, other, kind), () => setKey(""));
  const labelOf = (link: TaskLinkView) =>
    link.outgoing || link.kind === "relates" ? h.kinds[link.kind] : h.kinds[link.kind === "blocks" ? "blocked_by" : "duplicated_by"];
  return (
    <section className="mt-6" aria-label={h.links} data-links>
      <h2 className="text-sm font-medium text-muted">{h.links}</h2>
      {links.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{h.noLinks}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {links.map((link) => (
            <li key={link.id} className="flex min-h-9 flex-wrap items-center gap-2" data-link={link.other.key ?? "hidden"}>
              <span className="text-muted">{labelOf(link)}</span>
              {link.other.key ? (
                <Link prefetch={false} href={linkHref(shortId, link.other.key)} className={`hover:underline ${link.other.done || link.other.deleted ? "text-muted line-through" : ""}`}>
                  <span className="font-mono text-xs">{link.other.key}</span> {link.other.title}
                  {link.other.deleted && ` (${h.deletedTask})`}
                </Link>
              ) : (
                <span className="italic text-muted"><Icon name="lock" className="mr-1.5 inline" />{h.hidden}</span>
              )}
              {canEdit && (
                <button type="button" disabled={pending} onClick={() => run(() => deleteTaskLink(link.id))} aria-label={h.removeLink} className="min-h-9 px-2 text-muted hover:text-danger">
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (query) link(query);
          }}
        >
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={h.linkKind} className={inputClass}>
            {ADD_KINDS.map((value) => (
              <option key={value} value={value}>
                {h.addKinds[value]}
              </option>
            ))}
          </select>
          <div className="relative min-w-44 flex-1">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={h.linkKey} aria-label={h.linkKey} autoComplete="off" className={`${inputClass} w-full`} data-link-search />
            {offers.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border-strong bg-overlay p-1 shadow-xl" data-link-offers>
                {offers.map((o) => (
                  <li key={o.id}>
                    <button type="button" disabled={pending} onClick={() => link(o.key)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover md:min-h-9" data-link-offer={o.key}>
                      <span className="shrink-0 font-mono text-xs text-muted">{o.key}</span>
                      <span className="min-w-0 flex-1 truncate">{o.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" disabled={pending || !key.trim()} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9">
            {h.addLink}
          </button>
        </form>
      )}
      <Message message={message} />
    </section>
  );
}
