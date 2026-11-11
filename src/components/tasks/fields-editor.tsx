"use client";

import { useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { FIELD_KINDS, TASK_TYPES, type FieldKind, type FieldOption, type TaskField, type TaskType } from "@/lib/tasks";
import { deleteTaskField, saveTaskField } from "@/app/task-actions";
import { Icon } from "@/components/ui/icon";
import { TypeIcon } from "./task-icons";

const f = t.tasks.customFields;
const inputClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base hover:border-border-strong md:h-9 md:min-h-0 md:text-sm";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-hover px-3 text-[13px] font-medium hover:border-border-strong disabled:opacity-50 md:h-8 md:min-h-0";
const LISTS: FieldKind[] = ["select", "multiselect"];
const PALETTE = ["#94a3b8", "#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6"];

const newOptionId = () => Math.random().toString(36).slice(2, 10);

type Draft = { id: string | null; name: string; kind: FieldKind; options: FieldOption[]; required: boolean; types: TaskType[]; hint: string };
const toDraft = (field: TaskField): Draft => ({
  id: field.id,
  name: field.name,
  kind: field.kind,
  options: field.options,
  required: field.required,
  types: field.task_types ?? [],
  hint: field.hint ?? "",
});

// The project owner's list of fields: name, kind, list items with colours,
// "to fill in", and which task types have the field.
export function FieldsEditor({ projectId, fields: saved }: { projectId: string; fields: TaskField[] }) {
  const router = useRouter();
  // Shown order: changes at once on a drop, the server catches up.
  const [fields, setFields] = useState(saved);
  const [fromServer, setFromServer] = useState(saved);
  if (fromServer !== saved) {
    setFromServer(saved);
    setFields(saved);
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = (event: DragEndEvent) => {
    const from = fields.findIndex((x) => x.id === event.active.id);
    const to = fields.findIndex((x) => x.id === event.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    const rest = fields.filter((_, i) => i !== from);
    // Dropped on a field: take its place (after it when moving down).
    const at = rest.findIndex((x) => x.id === fields[to].id) + (from < to ? 1 : 0);
    const prev = rest[at - 1];
    const next = rest[at];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 0;
    const field = { ...fields[from], position };
    const before = fields;
    setFields([...rest.slice(0, at), field, ...rest.slice(at)]);
    startTransition(async () => {
      const result = await saveTaskField(projectId, field.id, { name: field.name, options: field.options, position });
      if (!result.ok) {
        setFields(before);
        setError(t.tasks.errors[result.error] ?? t.common.unknownError);
      }
      router.refresh();
    });
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const run = (action: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      if (result.ok) onOk?.();
      router.refresh();
    });
  const save = (d: Draft) =>
    run(
      () =>
        saveTaskField(projectId, d.id, {
          name: d.name,
          kind: d.kind,
          options: LISTS.includes(d.kind) ? d.options.filter((o) => o.label.trim()) : [],
          required: d.required,
          task_types: d.types,
          hint: d.hint.trim(),
        }),
      () => setDraft(null),
    );

  return (
    <div className="mt-6 space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {fields.length === 0 && !draft && <p className="text-sm text-muted">{f.none}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <ul className="space-y-2" aria-label={f.title}>
        {fields.map((field) =>
          draft?.id === field.id ? (
            <li key={field.id}>
              <DraftForm draft={draft} setDraft={setDraft} onSave={save} pending={pending} />
            </li>
          ) : (
            <SortableField key={field.id} id={field.id} name={field.name} disabled={pending || !!draft}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{field.name}</span> <span className="text-muted">· {f.kinds[field.kind]}</span>
                {field.required && <span className="text-muted"> · {f.required}</span>}
                <span className="block text-xs text-muted">
                  {field.task_types?.length ? field.task_types.map((type) => t.tasks.types[type]).join(", ") : f.allTypes}
                  {LISTS.includes(field.kind) && ` · ${field.options.map((o) => o.label).join(", ")}`}
                </span>
                {field.hint && <span className="block text-xs text-muted"><Icon name="info" className="mr-1.5 inline" />{field.hint}</span>}
              </span>
              <button type="button" className={buttonClass} disabled={pending} onClick={() => setDraft(toDraft(field))}>
                {f.edit}
              </button>
              <button
                type="button"
                className={`${buttonClass} text-danger`}
                disabled={pending}
                onClick={() => {
                  if (confirm(f.deleteConfirm(field.name))) run(() => deleteTaskField(field.id));
                }}
              >
                {f.delete}
              </button>
            </SortableField>
          ),
        )}
      </ul>
      </DndContext>
      {draft && draft.id === null ? (
        <DraftForm draft={draft} setDraft={setDraft} onSave={save} pending={pending} />
      ) : (
        !draft && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setDraft({ id: null, name: "", kind: "text", options: [{ id: newOptionId(), label: "", color: PALETTE[6] }], required: false, types: [], hint: "" })}
          >
            <Icon name="plus" className="mr-1 inline" />
            {f.add}
          </button>
        )
      )}
    </div>
  );
}

// A field row: dragged by its handle, and a drop target for the others.
function SortableField({ id, name, disabled, children }: { id: string; name: string; disabled: boolean; children: React.ReactNode }) {
  const drag = useDraggable({ id, disabled });
  const drop = useDroppable({ id, disabled });
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined;
  return (
    <li
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={style}
      className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${drag.isDragging ? "relative z-10 border-accent bg-background shadow-lg" : drop.isOver ? "border-accent" : "border-border"}`}
      data-custom-field={name}
    >
      <button type="button" {...drag.listeners} {...drag.attributes} aria-label={f.dragHandle(name)} disabled={disabled} className="h-9 w-7 cursor-grab touch-none rounded text-muted hover:bg-surface disabled:cursor-default disabled:opacity-40" data-field-handle>
        <Icon name="drag" />
      </button>
      {children}
    </li>
  );
}

// "＋ Field" right where a task is filled in (project owners and workspace admins):
// the same short form; the new field joins the project and shows at once.
export function QuickAddField({ projectId, nested = false }: { projectId: string; nested?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!draft)
    return (
      <button
        type="button"
        className={`${buttonClass} justify-self-start`}
        onClick={() => setDraft({ id: null, name: "", kind: "text", options: [{ id: newOptionId(), label: "", color: PALETTE[6] }], required: false, types: [], hint: "" })}
        data-quick-add-field
      >
        <Icon name="plus" className="mr-1 inline" />
        <Icon name="plus" className="mr-1 inline" />
        {f.quickAdd}
      </button>
    );
  return (
    <div className="col-span-full space-y-2">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <DraftForm
        draft={draft}
        setDraft={setDraft}
        pending={pending}
        nested={nested}
        onSave={(d) =>
          startTransition(async () => {
            const result = await saveTaskField(projectId, null, {
              name: d.name,
              kind: d.kind,
              options: LISTS.includes(d.kind) ? d.options.filter((o) => o.label.trim()) : [],
              required: d.required,
              task_types: d.types,
              hint: d.hint.trim(),
            });
            if (!result.ok) return setError(t.tasks.errors[result.error] ?? t.common.unknownError);
            setError(null);
            setDraft(null);
            router.refresh();
          })
        }
      />
    </div>
  );
}

function DraftForm({ draft, setDraft, onSave, pending, nested = false }: { draft: Draft; setDraft: (d: Draft | null) => void; onSave: (d: Draft) => void; pending: boolean; nested?: boolean }) {
  const set = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });
  const isNew = draft.id === null;
  // Inside another form (the new-task window) it is a group, saved by its button.
  const Wrapper = nested ? "div" : "form";
  return (
    <Wrapper
      {...(nested
        ? {
            role: "group",
            // Enter saves the field, not the outer form (the task).
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                e.preventDefault();
                if (draft.name.trim()) onSave(draft);
              }
            },
          }
        : {})}
      className="space-y-3 rounded-lg border border-accent p-3 text-sm"
      aria-label={isNew ? f.add : f.edit}
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <label className="flex flex-col gap-1">
          {f.name}
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          {f.kind}
          <select value={draft.kind} disabled={!isNew} aria-label={f.kind} onChange={(e) => set({ kind: e.target.value as FieldKind })} className={inputClass}>
            {FIELD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {f.kinds[kind]}
              </option>
            ))}
          </select>
          {!isNew && <span className="text-xs text-muted">{f.kindFixed}</span>}
        </label>
      </div>

      <label className="flex flex-col gap-1">
        {f.hint}
        <input value={draft.hint} onChange={(e) => set({ hint: e.target.value })} maxLength={300} placeholder={f.hintPlaceholder} className={inputClass} data-field-hint-input />
      </label>

      {LISTS.includes(draft.kind) && (
        <fieldset className="space-y-2">
          <legend className="mb-1">{f.options}</legend>
          {draft.options.map((option, i) => (
            <div key={option.id} className="flex items-center gap-2">
              <input
                type="color"
                value={option.color ?? PALETTE[0]}
                onChange={(e) => set({ options: draft.options.map((o) => (o.id === option.id ? { ...o, color: e.target.value } : o)) })}
                aria-label={f.optionColor}
                className="h-9 w-10 shrink-0 rounded border border-border"
              />
              <input
                value={option.label}
                onChange={(e) => set({ options: draft.options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)) })}
                placeholder={f.optionPlaceholder(i + 1)}
                aria-label={f.optionPlaceholder(i + 1)}
                maxLength={60}
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button type="button" aria-label={f.moveUp} disabled={i === 0} onClick={() => {
                const next = [...draft.options];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                set({ options: next });
              }} className={buttonClass}>
                <Icon name="arrow-up" />
              </button>
              <button type="button" aria-label={f.removeOption} onClick={() => set({ options: draft.options.filter((o) => o.id !== option.id) })} className={buttonClass}>
                <Icon name="close" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={buttonClass}
            onClick={() => set({ options: [...draft.options, { id: newOptionId(), label: "", color: PALETTE[draft.options.length % PALETTE.length] }] })}
          >
            <Icon name="plus" className="mr-1 inline" />
            {f.addOption}
          </button>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-1">{f.types}</legend>
        <div className="flex flex-wrap gap-3">
          {TASK_TYPES.map((type) => (
            <label key={type} className="flex min-h-11 items-center gap-2 md:min-h-9">
              <input
                type="checkbox"
                checked={draft.types.includes(type)}
                onChange={(e) => set({ types: e.target.checked ? [...draft.types, type] : draft.types.filter((x) => x !== type) })}
                className="h-5 w-5"
              />
              <TypeIcon type={type} className="mr-1 inline" />
              {t.tasks.types[type]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">{f.typesHint}</p>
      </fieldset>

      <label className="flex min-h-11 items-center gap-2 md:min-h-9">
        <input type="checkbox" checked={draft.required} onChange={(e) => set({ required: e.target.checked })} className="h-5 w-5" />
        {f.required}
        <span className="text-xs text-muted">— {f.requiredHint}</span>
      </label>

      <div className="flex gap-2">
        <button type={nested ? "button" : "submit"} onClick={nested ? () => onSave(draft) : undefined} disabled={pending || !draft.name.trim()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
          {t.common.save}
        </button>
        <button type="button" onClick={() => setDraft(null)} className={buttonClass}>
          {t.common.cancel}
        </button>
      </div>
    </Wrapper>
  );
}
