"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { pagePath, workspacePath } from "@/lib/paths";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { StatusButtons, moveAllowed } from "./status-buttons";
import { PriorityPicker } from "./priority-picker";
import { KeyFields } from "./key-fields";
import type { TaskWebLink } from "./task-files";
import type { ActionResult } from "@/lib/action-result";
import {
  TASK_PRIORITIES,
  TASK_TYPES,
  personLabel,
  fieldApplies,
  isEmptyValue,
  type Person,
  type TaskBoardInfo,
  type TaskField,
  type TaskRow,
  type TaskStatus,
  type ColumnMoves,
} from "@/lib/tasks";
import { FieldValue } from "./field-value";
import { QuickAddField } from "./fields-editor";
import { TaskFiles, type TaskFileView } from "./task-files";
import { SaveTemplateDialog } from "./task-templates";
import { templateOf } from "@/lib/task-templates";
import { BlockedNotice, ParentPicker, Subtasks, TaskLinks, type ProjectTask, type TaskLinkView } from "./task-relations";
import { LabelsEditor, PeoplePicker, quietClass } from "./task-pickers";
import { addTaskComment, deleteTask, editTaskComment, moveTaskOnBoard, setTaskParticipants, setTaskPrivate, updateTask } from "@/app/task-actions";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { TypeIcon } from "./task-icons";

const TaskDescription = dynamic(() => import("./task-description"), { ssr: false, loading: () => <p className="text-sm text-muted">…</p> });

export type TaskComment = { id: string; author_id: string | null; body: string; mentions: string[]; created_at: string; edited_at: string | null };
// An imported task: its key and address in the old tracker, and people who aren't members here.
export type TaskOrigin = { external_key: string | null; external_url: string | null; imported_reporter: string | null; imported_assignee: string | null };
export type TaskEvent = { id: string; actor_id: string | null; field: string; old_value: unknown; new_value: unknown; created_at: string };

const k = t.tasks;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const when = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

// One task in two columns: what it is about on the left (title, description, subtasks,
// links, files, comments and history), its properties on the right. On a narrow screen
// the properties come right after the description.
export function TaskDetail({
  taskKey,
  shortId,
  project,
  projectTasks,
  projectLabels = [],
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
  moves = {},
  inPanel = false,
  origin = null,
  importedNames = {},
  webLinks = [],
}: {
  taskKey: string;
  shortId: string;
  project: { id: string; key: string };
  projectTasks: ProjectTask[];
  // Labels already used in the project (offered while typing a label).
  projectLabels?: string[];
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
  moves?: ColumnMoves;
  // Shown in the panel over the board: the project's other tasks open in the same panel.
  inPanel?: boolean;
  origin?: TaskOrigin | null;
  // Comment or history line id → the tracker's name of whoever wrote it (not tied to a member yet).
  importedNames?: Record<string, string>;
  webLinks?: TaskWebLink[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const hrefFor = inPanel
    ? (number: number) => {
        const query = new URLSearchParams(params.toString());
        query.set("task", String(number));
        return `${pathname}?${query}`;
      }
    : undefined;
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [allFields, setAllFields] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // The project's own fields: those with a value always show; a long tail of empty ones folds.
  const applicable = fields.filter((field) => fieldApplies(field, task.type));
  const emptyFields = applicable.filter((field) => !field.required && isEmptyValue(task.custom?.[field.id]));
  const folded = emptyFields.length > 3 && !allFields;
  const shownFields = folded ? applicable.filter((field) => !emptyFields.includes(field)) : applicable;
  const people = (role: "co_assignee" | "responsible") => participants.filter((x) => x.role === role).map((x) => x.user_id);
  const setPeople = (role: "co_assignee" | "responsible", ids: string[]) =>
    run(() => setTaskParticipants(task.id, [...participants.filter((x) => x.role !== role && !ids.includes(x.user_id)), ...ids.map((user_id) => ({ user_id, role }))]));

  // What a history line says about the values, where they read well.
  const shown = (field: string, value: unknown): string | null => {
    if (!VALUE_FIELDS.has(field)) return null;
    if (value === null || value === undefined || value === "") return "—";
    switch (field) {
      case "status_id":
        return statuses.find((x) => x.id === value)?.name ?? null;
      case "assignee_id":
        return who(String(value));
      case "priority":
        return k.priorities[value as keyof typeof k.priorities] ?? null;
      case "type":
        return k.types[value as keyof typeof k.types] ?? null;
      case "start_date":
      case "due_date":
        return new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(`${String(value)}T00:00:00`));
      case "estimate":
        return String(value);
      case "title":
        return String(value).length > 60 ? `${String(value).slice(0, 60)}…` : String(value);
      case "labels":
        return Array.isArray(value) ? value.join(", ") || "—" : null;
      default:
        return null;
    }
  };
  const history = groupEvents(events);

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${workspacePath(shortId, `/tasks/${project.key}/${task.number}`)}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const boardOfTask = statuses.find((x) => x.id === task.status_id)?.board_id ?? null;
  return (
    <div className="@container mt-4" data-task-detail>
      <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 @3xl:col-start-1">
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate font-mono text-sm text-muted">
              {parent && (
                <>
                  <Link scroll={!hrefFor} href={hrefFor?.(parent.number) ?? workspacePath(shortId, `/tasks/${project.key}/${parent.number}`)} className="hover:text-foreground hover:underline" data-parent-link>
                    <TypeIcon type={parent.type} className="mr-1 inline" />
                    {project.key}-{parent.number}
                  </Link>
                  {" / "}
                </>
              )}
              <TypeIcon type={task.type} className="mr-1 inline" />
              {taskKey}
            </p>
            {copied && (
              <span role="status" className="text-xs text-muted">
                {k.card.linkCopied}
              </span>
            )}
            <IconButton icon="link" label={k.card.copyLink} onClick={copyLink} data-copy-task-link />
          </div>
          {/* A computer: the columns as a row of buttons (the task's board first, other boards
              after it). A phone: only the list. */}
          <div className="mt-2 text-sm" data-task-status-area>
          <StatusButtons
            groups={[boardOfTask, ...[null, ...boards.map((x) => x.id)].filter((id) => id !== boardOfTask)].flatMap((board) => {
              const columns = statuses.filter((s) => (s.board_id ?? null) === board);
              return columns.length ? [{ label: boards.length ? (boards.find((x) => x.id === board)?.name ?? t.tasks.boards.main) : null, statuses: columns }] : [];
            })}
            current={task.status_id}
            moves={moves}
            disabled={!canEdit || pending}
            onPick={(id) => run(() => moveTaskOnBoard(task.id, id))}
          />
          <label className="inline-flex max-w-full min-w-0 items-center gap-2 md:hidden">
            <span className="text-xs text-muted">{k.fields.status}</span>
            <select value={task.status_id} disabled={!canEdit || pending} onChange={(e) => run(() => moveTaskOnBoard(task.id, e.target.value))} className="min-h-11 min-w-0 rounded-lg border border-border bg-hover px-2 text-sm font-medium hover:border-border-strong md:h-8 md:min-h-0" data-task-status>
              {/* Columns of every board: picking another team's column moves the task to its board. */}
              {[null, ...boards.map((x) => x.id)].map((board) => {
                const columns = statuses.filter((s) => (s.board_id ?? null) === board);
                if (!columns.length) return null;
                const options = columns.map((s) => (
                  <option key={s.id} value={s.id} disabled={!moveAllowed(moves, task.status_id, s.id)}>
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
          </label>
          </div>
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
              className="mt-1 w-full resize-none bg-transparent text-xl font-semibold tracking-tight outline-none [field-sizing:content]"
            />
          ) : (
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{task.title}</h1>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <BlockedNotice links={links} />
          {(isOwner || applicable.length > 0) && (
            <div className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-border p-3 text-sm @xl:grid-cols-2" aria-label={k.customFields.heading} role="group" data-task-key-fields>
              <KeyFields
                projectId={project.id}
                fields={shownFields}
                all={fields}
                canOrder={isOwner}
                render={(field) => <FieldValue field={field} value={task.custom?.[field.id]} members={members} disabled={!canEdit || pending} onChange={(value) => change({ custom: { [field.id]: value } })} />}
              />
              {emptyFields.length > 3 && (
                <button type="button" onClick={() => setAllFields(!allFields)} aria-expanded={allFields} className="min-h-11 self-start text-xs @xl:col-span-2 text-muted hover:text-foreground hover:underline md:min-h-8" data-more-fields>
                  <Icon name={allFields ? "chevron-up" : "chevron-down"} className="mr-1 inline" />
                  {allFields ? k.card.fewerFields : k.card.moreFields(emptyFields.length)}
                </button>
              )}
              {isOwner && (
                <div className="@xl:col-span-2">
                  <QuickAddField projectId={project.id} />
                </div>
              )}
            </div>
          )}

          <h2 className="mt-5 text-sm font-medium text-muted">{k.description}</h2>
          <div className="-mx-3 mt-2">
            <TaskDescription shortId={shortId} taskId={task.id} initial={task.description} editable={canEdit} />
          </div>
          <TaskFiles shortId={shortId} taskId={task.id} files={files} links={webLinks} members={members} me={me} canEdit={canEdit} />
        </div>

        <aside className="min-w-0 self-start rounded-xl border border-border p-3 text-sm @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1" aria-label={k.fields.heading} data-task-fields>
          <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{k.card.properties}</h2>
          <Row label={k.fields.assignee} plain>
            <PeoplePicker name="assignee" label={k.fields.assignee} members={members} value={task.assignee_id ? [task.assignee_id] : []} disabled={!canEdit || pending} empty={k.unassigned} onChange={(ids) => change({ assignee_id: ids[0] ?? null })} />
          </Row>
          {!task.assignee_id && origin?.imported_assignee && (
            <p className="pb-1 pl-[7rem] text-xs text-muted" data-imported-assignee>
              {k.importer.inTracker(origin.imported_assignee)} · {k.importPeople.notSeated}
            </p>
          )}
          {(["co_assignee", "responsible"] as const).map((role) => (
            <Row key={role} label={k.privacy.roles[role]} plain data-participants={role}>
              <PeoplePicker name={role} label={k.privacy.roles[role]} members={members} value={people(role)} multiple disabled={!canEdit || pending} empty={k.pickers.nobody} onChange={(ids) => setPeople(role, ids)} />
            </Row>
          ))}
          <Row label={k.fields.priority}>
<PriorityPicker value={task.priority} disabled={!canEdit || pending} onChange={(priority) => change({ priority })} />
          </Row>
          <Row label={k.fields.type}>
            <select value={task.type} disabled={!canEdit || pending} onChange={(e) => change({ type: e.target.value })} className={quietClass}>
              {TASK_TYPES.map((value) => (
                <option key={value} value={value}>
                  {k.types[value]}
                </option>
              ))}
            </select>
          </Row>
          <Row label={k.fields.startDate}>
            <input type="date" defaultValue={task.start_date ?? ""} disabled={!canEdit} onChange={(e) => change({ start_date: e.target.value || null })} className={quietClass} />
          </Row>
          <Row label={k.fields.dueDate}>
            <input type="date" defaultValue={task.due_date ?? ""} disabled={!canEdit} onChange={(e) => change({ due_date: e.target.value || null })} className={quietClass} />
          </Row>
          <Row label={k.fields.estimate}>
            <input
              type="number"
              min={0}
              step={0.5}
              defaultValue={task.estimate ?? ""}
              disabled={!canEdit}
              placeholder="—"
              onBlur={(e) => {
                const value = e.currentTarget.value === "" ? null : Number(e.currentTarget.value);
                if (value !== task.estimate) change({ estimate: value });
              }}
              className={quietClass}
            />
          </Row>
          <Row label={k.fields.labels} plain>
            <LabelsEditor value={task.labels} known={projectLabels} disabled={!canEdit} onChange={(labels) => change({ labels })} />
          </Row>
          <Row label={k.hierarchy.parent} plain>
            <ParentPicker task={task} tasks={projectTasks} canEdit={canEdit} projectKey={project.key} />
          </Row>


          <div className="mt-3 border-t border-border px-2 pt-1 [&_h2]:text-xs [&_section]:mt-3" data-task-side-blocks>
          <Subtasks shortId={shortId} projectId={project.id} projectKey={project.key} task={task} tasks={projectTasks} statuses={statuses} canEdit={canEdit} hrefFor={hrefFor} />
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
                      {page.icon ? <span aria-hidden="true">{page.icon}</span> : <Icon name="file-text" className="inline text-muted" />} {page.title || t.pages.untitled}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>

          {(task.private || task.reporter_id === me) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border px-2 pt-3" data-task-privacy>
              {task.private ? (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300" data-task-private>
                  <Icon name="lock" className="mr-1 inline" />
                  {k.privacy.private}
                </span>
              ) : null}
              {task.reporter_id === me && (
                <button type="button" disabled={pending} onClick={() => run(() => setTaskPrivate(task.id, !task.private))} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-8" data-toggle-private>
                  {task.private ? k.privacy.publish : k.privacy.makePrivate}
                </button>
              )}
              {task.private && <span className="text-xs text-muted">{k.privacy.privateHint}</span>}
            </div>
          )}

          {columnTime.length > 0 && (
            <div className="mt-3 border-t border-border px-2 pt-3" data-column-time>
              <span className="text-xs text-muted">{k.columnTime.heading}</span>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {columnTime.map((c) => (
                  <li key={c.id} className="rounded-full border border-border px-2.5 py-1 text-xs" data-column-time-item={c.name}>
                    {c.name} · {k.columnTime.duration(c.ms)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="mt-3 space-y-1 border-t border-border px-2 pt-3 text-xs text-muted">
            <div>
              <dt className="inline">{k.fields.reporter}: </dt>
              <dd className="inline" data-task-reporter>{task.reporter_id || !origin?.imported_reporter ? who(task.reporter_id) : origin.imported_reporter}</dd>
            </div>
            {origin?.external_key && (
              <div data-task-origin>
                <dt className="inline">{k.importer.movedFrom}: </dt>
                <dd className="inline">
                  {origin.external_url ? (
                    <a href={origin.external_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                      {origin.external_key}
                    </a>
                  ) : (
                    origin.external_key
                  )}
                </dd>
              </div>
            )}
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
        </aside>

        <div className="min-w-0 @3xl:col-start-1">

          <div className="mt-8">
            <Segmented
              label={k.card.activity}
              value={tab}
              onChange={setTab}
              options={[
                { value: "comments", label: k.card.commentsTab(comments.length), icon: "comment" },
                { value: "history", label: k.history, icon: "history" },
              ]}
            />
          </div>
          <div hidden={tab !== "comments"} data-task-comments>
            {comments.length === 0 && <p className="mt-3 text-sm text-muted">{k.card.noComments}</p>}
            <ul className="mt-3 space-y-3" aria-label={k.comments}>
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm" data-task-comment>
                  <p className="text-xs text-muted">
                    {!c.author_id && importedNames[c.id] ? k.importer.fromTracker(importedNames[c.id]) : who(c.author_id)} · {when(c.created_at)}
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
          </div>
          <div hidden={tab !== "history"} data-task-history>
            {history.length === 0 && <p className="mt-3 text-sm text-muted">{k.card.noHistory}</p>}
            <ul className="mt-3 space-y-1.5 text-xs text-muted" aria-label={k.history}>
              {history.map((e) => {
                const from = shown(e.field, e.old_value);
                const to = shown(e.field, e.new_value);
                return (
                  <li key={e.id} data-history-line={e.field}>
                    {when(e.created_at)} — {!e.actor_id && importedNames[e.id] ? k.importer.fromTracker(importedNames[e.id]) : who(e.actor_id)} {k.historyLine[e.field] ?? e.field}
                    {e.field !== "created" && from !== null && to !== null && (
                      <span className="text-foreground">
                        : {from} → {to}
                      </span>
                    )}
                    {e.count > 1 && ` · ${k.card.edits(e.count)}`}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {canEdit && (
              <button type="button" onClick={() => setSavingTemplate(true)} className="min-h-11 text-sm hover:underline md:min-h-9" data-save-template>
                <Icon name="template" className="mr-1 inline" />
                {k.templates.saveAs}
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
    </div>
  );
}

// History lines that also say what changed to what.
const VALUE_FIELDS = new Set(["status_id", "assignee_id", "priority", "type", "start_date", "due_date", "estimate", "title", "labels"]);

// A row of the properties panel: the name on the left, the control on the right.
// `plain`: the control names itself (a picker), so the row is not a <label>.
function Row({ label, plain, children, ...rest }: { label: string; plain?: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-1" {...rest}>
      <span className="flex min-h-11 items-center pl-2 text-xs text-muted md:min-h-8">{label}</span>
      <div className="min-w-0">{children}</div>
    </Tag>
  );
}

// Autosaves of the description come in dozens: a run of them by one person (less than
// an hour between neighbours) is one line with the number of edits.
function groupEvents(events: TaskEvent[]): (TaskEvent & { count: number })[] {
  const lines: (TaskEvent & { count: number; earliest: string })[] = [];
  for (const event of events) {
    const last = lines.at(-1);
    if (event.field === "description" && last?.field === "description" && last.actor_id === event.actor_id && Date.parse(last.earliest) - Date.parse(event.created_at) < 3_600_000) {
      last.count += 1;
      last.earliest = event.created_at;
    } else lines.push({ ...event, count: 1, earliest: event.created_at });
  }
  return lines;
}
