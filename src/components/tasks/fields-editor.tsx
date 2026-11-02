"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { FIELD_KINDS, TASK_TYPES, TYPE_ICONS, type FieldKind, type FieldOption, type TaskField, type TaskType } from "@/lib/tasks";
import { deleteTaskField, saveTaskField } from "@/app/task-actions";

const f = t.tasks.customFields;
const inputClass = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";
const LISTS: FieldKind[] = ["select", "multiselect"];
const PALETTE = ["#94a3b8", "#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6"];

const newOptionId = () => Math.random().toString(36).slice(2, 10);

type Draft = { id: string | null; name: string; kind: FieldKind; options: FieldOption[]; required: boolean; types: TaskType[] };
const toDraft = (field: TaskField): Draft => ({
  id: field.id,
  name: field.name,
  kind: field.kind,
  options: field.options,
  required: field.required,
  types: field.task_types ?? [],
});

// The project owner's list of fields: name, kind, list items with colours,
// "to fill in", and which task types have the field.
export function FieldsEditor({ projectId, fields }: { projectId: string; fields: TaskField[] }) {
  const router = useRouter();
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
      <ul className="space-y-2" aria-label={f.title}>
        {fields.map((field) =>
          draft?.id === field.id ? (
            <li key={field.id}>
              <DraftForm draft={draft} setDraft={setDraft} onSave={save} pending={pending} />
            </li>
          ) : (
            <li key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm" data-custom-field={field.name}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{field.name}</span> <span className="text-muted">· {f.kinds[field.kind]}</span>
                {field.required && <span className="text-muted"> · {f.required}</span>}
                <span className="block text-xs text-muted">
                  {field.task_types?.length ? field.task_types.map((type) => `${TYPE_ICONS[type]} ${t.tasks.types[type]}`).join(", ") : f.allTypes}
                  {LISTS.includes(field.kind) && ` · ${field.options.map((o) => o.label).join(", ")}`}
                </span>
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
            </li>
          ),
        )}
      </ul>
      {draft && draft.id === null ? (
        <DraftForm draft={draft} setDraft={setDraft} onSave={save} pending={pending} />
      ) : (
        !draft && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setDraft({ id: null, name: "", kind: "text", options: [{ id: newOptionId(), label: "", color: PALETTE[6] }], required: false, types: [] })}
          >
            ＋ {f.add}
          </button>
        )
      )}
    </div>
  );
}

function DraftForm({ draft, setDraft, onSave, pending }: { draft: Draft; setDraft: (d: Draft | null) => void; onSave: (d: Draft) => void; pending: boolean }) {
  const set = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });
  const isNew = draft.id === null;
  return (
    <form
      className="space-y-3 rounded-lg border border-accent p-3 text-sm"
      aria-label={isNew ? f.add : f.edit}
      onSubmit={(e) => {
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
          <select value={draft.kind} disabled={!isNew} onChange={(e) => set({ kind: e.target.value as FieldKind })} className={inputClass}>
            {FIELD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {f.kinds[kind]}
              </option>
            ))}
          </select>
          {!isNew && <span className="text-xs text-muted">{f.kindFixed}</span>}
        </label>
      </div>

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
                ↑
              </button>
              <button type="button" aria-label={f.removeOption} onClick={() => set({ options: draft.options.filter((o) => o.id !== option.id) })} className={buttonClass}>
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={buttonClass}
            onClick={() => set({ options: [...draft.options, { id: newOptionId(), label: "", color: PALETTE[draft.options.length % PALETTE.length] }] })}
          >
            ＋ {f.addOption}
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
              {TYPE_ICONS[type]} {t.tasks.types[type]}
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
        <button type="submit" disabled={pending || !draft.name.trim()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 md:min-h-9">
          {t.common.save}
        </button>
        <button type="button" onClick={() => setDraft(null)} className={buttonClass}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
