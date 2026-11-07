"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { pagePath, workspacePath } from "@/lib/paths";
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
  fieldApplies,
  type Person,
  type TaskBoardInfo,
  type TaskField,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";
import { FieldValue } from "./field-value";
import { QuickAddField } from "./fields-editor";
import { TaskFiles, type TaskFileView } from "./task-files";
import { SaveTemplateDialog } from "./task-templates";
import { templateOf } from "@/lib/task-templates";
import { BlockedNotice, ParentPicker, Subtasks, TaskLinks, type ProjectTask, type TaskLinkView } from "./task-relations";
import { addTaskComment, deleteTask, editTaskComment, moveTaskOnBoard, setTaskParticipants, setTaskPrivate, updateTask } from "@/app/task-actions";

const TaskDescription = dynamic(() => import("./task-description"), { ssr: false, loading: () => <p className="text-sm text-muted">…</p> });

export type TaskComment = { id: string; author_id: string | null; body: string; mentions: string[]; created_at: string; edited_at: string | null };
export type TaskEvent = { id: string; actor_id: string | null; field: string; old_value: unknown; new_value: unknown; created_at: string };

const k = t.tasks;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

// One task: the title, its fields on the side, the description, comments and history.
export function TaskDetail({
  taskKey,
  shortId,
  project,
  projectTasks,
  links,
  files,
  mentionedOn,
  task,
  statuses,
  fields,
  members,
  comments,
  events,
  columnTime,
  participants,
  boards = [],
  me,
  canEdit,
  canComment,
  isOwner,
}: {
  taskKey: string;
  shortId: string;
  project: { id: string; key: string };
  projectTasks: ProjectTask[];
  links: TaskLinkView[];
  files: TaskFileView[];
  mentionedOn: { id: string; title: string; icon: string | null }[];
  task: TaskRow & { description: unknown; deleted_at: string | null };
  statuses: TaskStatus[];
  fields: TaskField[];
  members: Person[];
  comments: TaskComment[];
  events: TaskEvent[];
  columnTime: { id: string; name: string; ms: number }[];
  participants: { user_id: string; role: "co_assignee" | "responsible" }[];
  boards?: TaskBoardInfo[];
  me: string;
  canEdit: boolean;
  canComment: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const parent = projectTasks.find((other) => other.id === task.parent_id);
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
    <div className="mt-4">
      <div className="min-w-0">
        <p className="font-mono text-sm text-muted">
          {parent && (
            <>
              <Link href={workspacePath(shortId, `/tasks/${project.key}/${parent.number}`)} className="hover:text-foreground hover:underline" data-parent-link>
                {TYPE_ICONS[parent.type]} {project.key}-{parent.number}
              </Link>
              {" / "}
            </>
          )}
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
        <BlockedNotice links={links} />

        {/* All fields at the top, the free description below them (as in issue trackers). */}
        <section className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label={k.fields.heading} data-task-fields>
          <Field label={k.fields.status}>
            <select value={task.status_id} disabled={!canEdit || pending} onChange={(e) => run(() => moveTaskOnBoard(task.id, e.target.value))} className={inputClass} data-task-status>
              {/* Columns of every board: picking another team's column moves the task to its board. */}
              {[null, ...boards.map((x) => x.id)].map((board) => {
                const columns = statuses.filter((s) => (s.board_id ?? null) === board);
                if (!columns.length) return null;
                const options = columns.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ));
                return boards.length ? (
                  <optgroup key={board ?? "main"} label={boards.find((x) => x.id === board)?.name ?? t.tasks.boards.main}>
                    {options}
                  </optgroup>
                ) : (
                  options
                );
              })}
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
          <ParentPicker task={task} tasks={projectTasks} canEdit={canEdit} projectKey={project.key} />
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
          <Participants
            people={participants}
            members={members}
            disabled={!canEdit || pending}
            onChange={(next) => run(() => setTaskParticipants(task.id, next))}
          />
          <div className="col-span-full flex flex-wrap items-center gap-2 text-sm" data-task-privacy>
            {task.private ? (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300" data-task-private>
                🔒 {k.privacy.private}
              </span>
            ) : null}
            {task.reporter_id === me && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setTaskPrivate(task.id, !task.private))}
                className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
                data-toggle-private
              >
                {task.private ? k.privacy.publish : k.privacy.makePrivate}
              </button>
            )}
            {task.private && <span className="text-xs text-muted">{k.privacy.privateHint}</span>}
          </div>
          {(isOwner || fields.some((field) => fieldApplies(field, task.type))) && (
            <div className="col-span-full grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={k.customFields.heading} role="group">
              {fields
                .filter((field) => fieldApplies(field, task.type))
                .map((field) => (
                  <FieldValue
                    key={field.id}
                    field={field}
                    value={task.custom?.[field.id]}
                    members={members}
                    disabled={!canEdit || pending}
                    onChange={(value) => change({ custom: { [field.id]: value } })}
                  />
                ))}
              {isOwner && !task.deleted_at && <QuickAddField projectId={project.id} />}
            </div>
          )}
          {columnTime.length > 0 && (
            <div className="col-span-full border-t border-border pt-3" data-column-time>
              <span className="text-xs text-muted">{k.columnTime.heading}</span>
              <ul className="mt-1 flex flex-wrap gap-2">
                {columnTime.map((c) => (
                  <li key={c.id} className="rounded-full border border-border px-3 py-1 text-xs" data-column-time-item={c.name}>
                    {c.name} · {k.columnTime.duration(c.ms)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="col-span-full flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted">
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
        </section>

        <h2 className="mt-6 text-sm font-medium text-muted">{k.description}</h2>
        <div className="mt-2 -mx-3">
          <TaskDescription shortId={shortId} taskId={task.id} initial={task.description} editable={canEdit} />
        </div>

        <Subtasks shortId={shortId} projectId={project.id} projectKey={project.key} task={task} tasks={projectTasks} statuses={statuses} canEdit={canEdit} />
        <TaskLinks shortId={shortId} taskId={task.id} links={links} canEdit={canEdit} />
        <section className="mt-6" aria-label={t.tasks.wiki.mentionedOn} data-mentioned-on>
          <h2 className="text-sm font-medium text-muted">{t.tasks.wiki.mentionedOn}</h2>
          {mentionedOn.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t.tasks.wiki.notMentioned}</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {mentionedOn.map((page) => (
                <li key={page.id}>
                  <Link href={pagePath(shortId, page.id)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 hover:bg-surface">
                    <span aria-hidden="true">{page.icon ?? "📄"}</span> {page.title || t.pages.untitled}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <TaskFiles shortId={shortId} taskId={task.id} files={files} members={members} me={me} canEdit={canEdit} />

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

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {canEdit && (
            <button type="button" onClick={() => setSavingTemplate(true)} className="min-h-11 text-sm hover:underline md:min-h-9" data-save-template>
              📋 {k.templates.saveAs}
            </button>
          )}
          {savingTemplate && <SaveTemplateDialog projectId={project.id} isOwner={isOwner} data={templateOf(task)} onClose={() => setSavingTemplate(false)} />}
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
        </div>
      </div>
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

const PARTICIPANT_ROLES = ["co_assignee", "responsible"] as const;

// Co-assignees and the responsible: they see the task even when it is private.
function Participants({
  people,
  members,
  disabled,
  onChange,
}: {
  people: { user_id: string; role: "co_assignee" | "responsible" }[];
  members: Person[];
  disabled: boolean;
  onChange: (next: { user_id: string; role: "co_assignee" | "responsible" }[]) => void;
}) {
  return (
    <>
      {PARTICIPANT_ROLES.map((role) => {
        const chosen = people.filter((p) => p.role === role).map((p) => p.user_id);
        return (
          <label key={role} className="flex flex-col gap-1" data-participants={role}>
            <span className="text-xs text-muted">{k.privacy.roles[role]}</span>
            <select
              multiple
              value={chosen}
              disabled={disabled}
              onChange={(e) => {
                const picked = [...e.target.selectedOptions].map((o) => o.value);
                onChange([...people.filter((p) => p.role !== role && !picked.includes(p.user_id)), ...picked.map((user_id) => ({ user_id, role }))]);
              }}
              className="min-h-20 rounded-md border border-border bg-background px-2 text-base md:text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {personLabel(m)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </>
  );
}
