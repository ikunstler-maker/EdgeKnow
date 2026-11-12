"use client";

import { t } from "@/i18n";
import { isEmptyValue, personLabel, type Person, type TaskField } from "@/lib/tasks";
import { CODE_KINDS, OTHER, durationText, isOther, itemName, listOf, otherText, splitDuration } from "@/lib/field-lists";
import { Icon } from "@/components/ui/icon";
import { MultiPicker } from "./multi-picker";

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

  // A heading and a divider only shape the card.
  if (field.kind === "heading") {
    return (
      <h3 className="pt-1 text-sm font-semibold" data-field={field.name} data-field-heading>
        {field.name}
        {field.hint && <span className="ml-2 text-xs font-normal text-muted">{field.hint}</span>}
      </h3>
    );
  }
  if (field.kind === "divider") return <hr className="my-1 border-border" data-field={field.name} data-field-divider />;

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
            <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
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
        <span className="flex flex-col gap-1">
          <select
            value={isOther(text) ? OTHER : text}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value !== OTHER) return onChange(e.target.value || null);
              const own = window.prompt(f.otherPrompt)?.trim().slice(0, 100);
              if (own) onChange(OTHER + own);
            }}
            className={inputClass}
          >
            <option value="">—</option>
            {field.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            <option value={OTHER}>{isOther(text) ? `${f.other}: ${otherText(text)}` : `${f.other}…`}</option>
          </select>
        </span>
      ) : field.kind === "multiselect" ? (
        <MultiPicker name={field.name} options={field.options.map((o) => ({ value: o.id, label: o.label, color: o.color }))} value={Array.isArray(value) ? (value as string[]) : []} disabled={disabled} onChange={(next) => onChange(next.length ? next : null)} />
      ) : CODE_KINDS.includes(field.kind) ? (
        <MultiPicker name={field.name} options={listOf(field.kind).map((item) => ({ value: item.code, label: item.code, hint: itemName(item) }))} value={Array.isArray(value) ? (value as string[]) : []} disabled={disabled} onChange={(next) => onChange(next.length ? next : null)} />
      ) : field.kind === "duration" ? (
        <DurationInput name={field.name} seconds={typeof value === "number" ? value : null} disabled={disabled} onChange={onChange} />
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

// Hours, minutes and seconds; kept as seconds. Saved when the person leaves the three boxes.
function DurationInput({ name, seconds, disabled, onChange }: { name: string; seconds: number | null; disabled: boolean; onChange: (value: unknown) => void }) {
  const f = t.tasks.customFields;
  const now = seconds === null ? null : splitDuration(seconds);
  if (disabled) return <span className="flex min-h-9 items-center" data-duration={name}>{seconds === null ? "—" : durationText(seconds)}</span>;
  const box = "min-h-11 w-14 rounded-md border border-border bg-background px-1.5 text-base md:min-h-9 md:text-sm";
  return (
    <span
      className="flex items-center gap-1"
      onBlur={(e) => {
        // Still inside the three boxes: not yet.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const read = (part: string) => Math.max(0, Math.floor(Number(e.currentTarget.querySelector<HTMLInputElement>(`[data-duration-part="${part}"]`)?.value) || 0));
        const empty = ["h", "m", "s"].every((part) => (e.currentTarget.querySelector<HTMLInputElement>(`[data-duration-part="${part}"]`)?.value ?? "") === "");
        const next = empty ? null : read("h") * 3600 + read("m") * 60 + read("s");
        if (next !== seconds) onChange(next);
      }}
      data-duration={name}
    >
      {(["h", "m", "s"] as const).map((part) => (
        <span key={part} className="flex items-center gap-1">
          <input type="number" min={0} max={part === "h" ? 99999 : 59} defaultValue={now ? now[part] : ""} aria-label={`${name}: ${f.durationParts[part]}`} className={box} data-duration-part={part} />
          <span className="text-xs text-muted">{f.durationParts[part]}</span>
        </span>
      ))}
    </span>
  );
}
