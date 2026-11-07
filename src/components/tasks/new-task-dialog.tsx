"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { createTask } from "@/app/task-actions";
import { fromTemplate, type TaskTemplate } from "@/lib/task-templates";
import { TASK_PRIORITIES, TASK_TYPES, TYPE_ICONS, PRIORITY_ICONS, fieldApplies, isEmptyValue, personLabel, type Person, type TaskField, type TaskStatus, type TaskType } from "@/lib/tasks";
import { FieldValue } from "./field-value";

const n = t.tasks.newTask;
const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

// Plain text from the dialog → the editor's paragraphs.
const toDescription = (text: string) =>
  text
    .split("\n")
    .map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line, styles: {} }] : [] }));

// Creating a task in its own window: Esc, a click outside or ✕ closes it
// (asking first when something was typed).
export function NewTaskDialog({
  projectId,
  statuses,
  statusId,
  members,
  fields,
  template,
  onClose,
}: {
  projectId: string;
  statuses: TaskStatus[];
  statusId: string | null;
  members: Person[];
  fields: TaskField[];
  template: TaskTemplate | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const preset = template ? fromTemplate(template, "", fields.map((f) => f.id)) : {};
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState(statusId ?? statuses[0]?.id ?? "");
  const [type, setType] = useState<TaskType>((preset.type as TaskType) ?? "task");
  const [priority, setPriority] = useState((preset.priority as string) ?? "medium");
  const [assignee, setAssignee] = useState((preset.assignee_id as string) ?? "");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [onlyMe, setOnlyMe] = useState(false);
  const [custom, setCustom] = useState<Record<string, unknown>>((preset.custom as Record<string, unknown>) ?? {});
  const titleInput = useRef<HTMLInputElement>(null);

  const dirty = title.trim() !== "" || description.trim() !== "" || due !== "" || Object.values(custom).some((v) => !isEmptyValue(v));
  const close = () => {
    if (!dirty || confirm(n.discard)) onClose();
  };
  useEffect(() => titleInput.current?.focus(), []);

  const submit = (again: boolean) => {
    const value = title.trim();
    if (!value) return;
    const base = template ? fromTemplate(template, value, fields.map((f) => f.id)) : { title: value };
    const shown = Object.fromEntries(Object.entries(custom).filter(([id, v]) => !isEmptyValue(v) && fields.some((f) => f.id === id && fieldApplies(f, type))));
    startTransition(async () => {
      const result = await createTask(projectId, {
        ...base,
        type,
        priority,
        status_id: status || null,
        assignee_id: assignee || null,
        due_date: due || null,
        custom: shown,
        ...(description.trim() ? { description: toDescription(description) } : {}),
        ...(onlyMe ? { private: true } : {}),
      });
      if (!result.ok) return setError(t.tasks.errors[result.error] ?? t.common.unknownError);
      router.refresh();
      if (!again) return onClose();
      setError(null);
      setTitle("");
      setDescription("");
      titleInput.current?.focus();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={close} data-new-task-backdrop>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={n.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
        data-new-task
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">{n.title}</h2>
          <button type="button" onClick={close} aria-label={n.close} className="h-9 w-9 rounded text-muted hover:bg-surface">
            ✕
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <label className="flex flex-col gap-1">
            {n.name}
            <input ref={titleInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required className={inputClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              {n.column}
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {n.type}
              <select value={type} onChange={(e) => setType(e.target.value as TaskType)} className={inputClass}>
                {TASK_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {TYPE_ICONS[x]} {t.tasks.types[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {n.priority}
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                {TASK_PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {PRIORITY_ICONS[x]} {t.tasks.priorities[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {n.assignee}
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
                <option value="">{n.nobody}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {personLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {n.due}
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
            </label>
          </div>
          {fields.filter((f) => fieldApplies(f, type)).map((field) => (
            <FieldValue key={field.id} field={field} value={custom[field.id]} members={members} disabled={pending} onChange={(v) => setCustom({ ...custom, [field.id]: v })} />
          ))}
          <label className="flex flex-col gap-1">
            {n.description}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={10000} className={`${inputClass} py-2`} data-new-task-description />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-muted md:min-h-9" title={t.tasks.privacy.privateHint}>
            <input type="checkbox" checked={onlyMe} onChange={(e) => setOnlyMe(e.target.checked)} className="h-5 w-5" />
            {t.tasks.privacy.onlyMe}
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          <button type="submit" disabled={pending || !title.trim()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
            {n.create}
          </button>
          <button type="button" disabled={pending || !title.trim()} onClick={() => submit(true)} className={buttonClass}>
            {n.createAnother}
          </button>
          <button type="button" onClick={close} className={buttonClass}>
            {t.common.cancel}
          </button>
        </div>
      </form>
    </div>
  );
}
