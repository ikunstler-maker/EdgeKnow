"use client";

import { t } from "@/i18n";
import { isEmptyValue, personLabel, type Person, type TaskField } from "@/lib/tasks";
import { Icon } from "@/components/ui/icon";

const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";

// One of a project's own fields on a task, edited in the way its kind asks for.
// onChange gets the new value (null clears it).
export function FieldValue({
  field,
  value,
  members,
  disabled,
  onChange,
}: {
  field: TaskField;
  value: unknown;
  members: Person[];
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const f = t.tasks.customFields;
  const missing = field.required && isEmptyValue(value);
  const label = (
    <span className="flex items-center gap-1 text-xs text-muted">
      {field.name}
      {missing && <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">{f.toFill}</span>}
    </span>
  );
  const text = typeof value === "string" ? value : "";

  if (field.kind === "checkbox" || field.kind === "toggle") {
    const on = value === true;
    return (
      <label className="flex min-h-11 items-center justify-between gap-2 md:min-h-9" data-field={field.name} title={field.hint ?? undefined}>
        <span className="flex flex-col">
          {label}
          {field.hint && <span className="text-xs text-muted" data-field-hint>{field.hint}</span>}
        </span>
        {field.kind === "checkbox" ? (
          <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={field.name}
            disabled={disabled}
            onClick={() => onChange(!on)}
            className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-accent" : "bg-border"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        )}
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1" data-field={field.name}>
      {label}
      {field.hint && <span className="text-xs text-muted" data-field-hint>{field.hint}</span>}
      {field.kind === "select" ? (
        <select value={text} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.kind === "multiselect" ? (
        <span className="flex flex-wrap gap-1">
          {field.options.map((o) => {
            const chosen = Array.isArray(value) && value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                aria-pressed={chosen}
                onClick={() => {
                  const list = Array.isArray(value) ? (value as string[]) : [];
                  const next = chosen ? list.filter((id) => id !== o.id) : [...list, o.id];
                  onChange(next.length ? next : null);
                }}
                className={`min-h-9 rounded-full border px-3 text-xs ${chosen ? "border-transparent text-white" : "border-border"}`}
                style={chosen ? { background: o.color ?? "var(--accent)" } : undefined}
              >
                {o.label}
              </button>
            );
          })}
        </span>
      ) : field.kind === "person" ? (
        <select value={text} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {personLabel(m)}
            </option>
          ))}
        </select>
      ) : field.kind === "color" ? (
        <span className="flex items-center gap-2">
          <input type="color" value={text || "#000000"} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded border border-border" aria-label={field.name} />
          {text && (
            <button type="button" disabled={disabled} onClick={() => onChange(null)} className="text-xs text-muted hover:text-foreground">
              {f.clear}
            </button>
          )}
        </span>
      ) : field.kind === "date" ? (
        <input type="date" defaultValue={text} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={inputClass} />
      ) : field.kind === "number" ? (
        <input
          type="number"
          defaultValue={typeof value === "number" ? value : ""}
          disabled={disabled}
          onBlur={(e) => {
            const next = e.currentTarget.value === "" ? null : Number(e.currentTarget.value);
            if (next !== value) onChange(next);
          }}
          className={inputClass}
        />
      ) : field.kind === "longtext" ? (
        <textarea
          defaultValue={text}
          disabled={disabled}
          maxLength={10000}
          rows={3}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim() || null;
            if (next !== (text || null)) onChange(next);
          }}
          className={`${inputClass} py-2`}
        />
      ) : (
        <span className="flex items-center gap-2">
          <input
            type={field.kind === "url" ? "url" : "text"}
            defaultValue={text}
            disabled={disabled}
            maxLength={500}
            placeholder={field.kind === "url" ? "https://…" : undefined}
            onBlur={(e) => {
              const next = e.currentTarget.value.trim() || null;
              if (next !== (text || null)) onChange(next);
            }}
            className={inputClass}
          />
          {field.kind === "url" && text && (
            <a href={text} target="_blank" rel="noreferrer noopener" className="shrink-0 text-sm" aria-label={f.open}>
              <Icon name="arrow-up-right" />
            </a>
          )}
        </span>
      )}
    </label>
  );
}
