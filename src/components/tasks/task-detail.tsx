"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import {
  PRIORITY_ICONS,
  TASK_PRIORITIES,
  TASK_TYPES,
  TYPE_ICONS,
  personLabel,
  type Person,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";
import { addTaskComment, deleteTask, editTaskComment, updateTask } from "@/app/task-actions";

const TaskDescription = dynamic(() => import("./task-description"), { ssr: false, loading: () => <p className="text-sm text-muted">…</p> });

export type TaskComment = { id: string; author_id: string | null; body: string; mentions: string[]; created_at: string; edited_at: string | null };
export type TaskEvent = { id: string; actor_id: string | null; field: string; old_value: unknown; new_value: unknown; created_at: string };

const k = t.tasks;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

// One task: the title, its fields on the side, the description, comments and history.
export function TaskDetail({
  taskKey,
  task,
  statuses,
  members,
  comments,
  events,
  me,
  canEdit,
  canComment,
  isOwner,
}: {
  taskKey: string;
  task: TaskRow & { description: unknown; deleted_at: string | null };
  statuses: TaskStatus[];
  members: Person[];
  comments: TaskComment[];
  events: TaskEvent[];
  me: string;
  canEdit: boolean;
  canComment: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const personOf = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const who = (id: string | null) => personLabel(personOf.get(id ?? "")) || k.someone;

  const run = (action: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (k.errors[result.error] ?? t.common.unknownError));
      if (result.ok) onOk?.();
      router.refresh();
    });
  const change = (changes: Record<string, unknown>) => run(() => updateTask(task.id, changes));

  if (task.deleted_at) {
    return (
      <div className="mt-6 rounded-lg border border-border p-4">
        <p>
          <span className="font-mono">{taskKey}</span> {task.title}
        </p>
        <p className="mt-2 text-muted">{k.deleted}</p>
        {canEdit && (
          <button type="button" disabled={pending} onClick={() => run(() => deleteTask(task.id, true))} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-surface">
            {k.restore}
          </button>
        )}
      </div>
    );
  }

  // Mentions: @name or @email of a member, written in the comment.
  const mentionsIn = (text: string) =>
    members.filter((m) => [m.name, m.email.split("@")[0]].some((n) => n && text.toLowerCase().includes(`@${n.toLowerCase().split(" ")[0]}`))).map((m) => m.id);

  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0">
        <p className="font-mono text-sm text-muted">
          {TYPE_ICONS[task.type]} {taskKey}
        </p>
        {canEdit ? (
          <textarea
            defaultValue={task.title}
            aria-label={k.columns.title}
            rows={1}
            maxLength={300}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              if (value && value !== task.title) change({ title: value });
            }}
            className="mt-1 w-full resize-none bg-transparent text-2xl font-semibold outline-none [field-sizing:content]"
          />
        ) : (
          <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}

        <h2 className="mt-6 text-sm font-medium text-muted">{k.description}</h2>
        <div className="mt-2 -mx-3">
          <TaskDescription taskId={task.id} initial={task.description} editable={canEdit} />
        </div>

        <h2 className="mt-8 text-sm font-medium text-muted">{k.comments}</h2>
        <ul className="mt-2 space-y-3" aria-label={k.comments}>
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3 text-sm" data-task-comment>
              <p className="text-xs text-muted">
                {who(c.author_id)} · {when(c.created_at)}
                {c.edited_at && ` · ${k.edited}`}
              </p>
              {editing?.id === c.id ? (
                <form
                  className="mt-2 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => editTaskComment(c.id, editing.body), () => setEditing(null));
                  }}
                >
                  <textarea value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} className={`${inputClass} min-h-20 py-2`} />
                  <div className="flex gap-2">
                    <button type="submit" disabled={pending} className="min-h-9 rounded-md bg-accent px-3 text-white">
                      {t.common.save}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="min-h-9 rounded-md border border-border px-3">
                      {t.common.cancel}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              )}
              {editing?.id !== c.id && (c.author_id === me || isOwner) && (
                <div className="mt-2 flex gap-3 text-xs text-muted">
                  {c.author_id === me && (
                    <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} className="hover:text-foreground">
                      {k.editComment}
                    </button>
                  )}
                  <button type="button" onClick={() => run(() => editTaskComment(c.id, null, true))} className="hover:text-danger">
                    {k.deleteComment}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canComment && (
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = comment.trim();
              if (!body) return;
              run(() => addTaskComment(task.id, body, mentionsIn(body)), () => setComment(""));
            }}
          >
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={k.commentPlaceholder} aria-label={k.commentPlaceholder} className={`${inputClass} min-h-20 py-2`} />
            <button type="submit" disabled={pending || !comment.trim()} className="min-h-11 self-start rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
              {k.send}
            </button>
          </form>
        )}

        <h2 className="mt-8 text-sm font-medium text-muted">{k.history}</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted" aria-label={k.history}>
          {events.map((e) => (
            <li key={e.id}>
              {when(e.created_at)} — {who(e.actor_id)} {k.historyLine[e.field] ?? e.field}
            </li>
          ))}
        </ul>
      </div>

      <aside className="space-y-3 text-sm">
        <Field label={k.fields.status}>
          <select value={task.status_id} disabled={!canEdit || pending} onChange={(e) => change({ status_id: e.target.value })} className={inputClass}>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={k.fields.assignee}>
          <select value={task.assignee_id ?? ""} disabled={!canEdit || pending} onChange={(e) => change({ assignee_id: e.target.value || null })} className={inputClass}>
            <option value="">{k.unassigned}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {personLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={k.fields.priority}>
          <select value={task.priority} disabled={!canEdit || pending} onChange={(e) => change({ priority: e.target.value })} className={inputClass}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_ICONS[p]} {k.priorities[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={k.fields.type}>
          <select value={task.type} disabled={!canEdit || pending} onChange={(e) => change({ type: e.target.value })} className={inputClass}>
            {TASK_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_ICONS[value]} {k.types[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={k.fields.labels}>
          <input
            defaultValue={task.labels.join(", ")}
            disabled={!canEdit}
            placeholder={k.fields.labelsHint}
            onBlur={(e) => {
              const labels = [...new Set(e.currentTarget.value.split(",").map((l) => l.trim()).filter(Boolean))];
              if (labels.join(",") !== task.labels.join(",")) change({ labels });
            }}
            className={inputClass}
          />
        </Field>
        <Field label={k.fields.startDate}>
          <input type="date" defaultValue={task.start_date ?? ""} disabled={!canEdit} onChange={(e) => change({ start_date: e.target.value || null })} className={inputClass} />
        </Field>
        <Field label={k.fields.dueDate}>
          <input type="date" defaultValue={task.due_date ?? ""} disabled={!canEdit} onChange={(e) => change({ due_date: e.target.value || null })} className={inputClass} />
        </Field>
        <Field label={k.fields.estimate}>
          <input
            type="number"
            min={0}
            step={0.5}
            defaultValue={task.estimate ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              const value = e.currentTarget.value === "" ? null : Number(e.currentTarget.value);
              if (value !== task.estimate) change({ estimate: value });
            }}
            className={inputClass}
          />
        </Field>
        <dl className="space-y-1 border-t border-border pt-3 text-xs text-muted">
          <div>
            <dt className="inline">{k.fields.reporter}: </dt>
            <dd className="inline">{who(task.reporter_id)}</dd>
          </div>
          <div>
            <dt className="inline">{k.fields.created}: </dt>
            <dd className="inline">{when(task.created_at)}</dd>
          </div>
          <div>
            <dt className="inline">{k.fields.updated}: </dt>
            <dd className="inline">{when(task.updated_at)}</dd>
          </div>
          {task.done_at && (
            <div>
              <dt className="inline">{k.fields.done}: </dt>
              <dd className="inline">{when(task.done_at)}</dd>
            </div>
          )}
        </dl>
        {canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(k.deleteConfirm(taskKey))) run(() => deleteTask(task.id));
            }}
            className="min-h-11 text-sm text-danger hover:underline md:min-h-9"
          >
            {k.deleteTask}
          </button>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
