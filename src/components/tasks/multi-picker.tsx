"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { OTHER, isOther, otherText } from "@/lib/field-lists";
import { Icon } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";

export type PickerOption = { value: string; label: string; hint?: string; color?: string | null };

const m = t.tasks.multi;

// Several values from a list. Whoever may change them opens a list with checkboxes and a
// search, and may write a value of their own; the chosen ones show as chips. Whoever only
// reads sees just the chosen ones, compact.
export function MultiPicker({ name, options, value, disabled, onChange, allowOther = true }: { name: string; options: PickerOption[]; value: string[]; disabled: boolean; onChange: (next: string[]) => void; allowOther?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [own, setOwn] = useState("");
  const optionOf = new Map(options.map((o) => [o.value, o]));
  const labelOf = (v: string) => (isOther(v) ? otherText(v) : (optionOf.get(v)?.label ?? v));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  const chips = (
    <span className="flex min-w-0 flex-1 flex-wrap gap-1" data-multi-chosen>
      {value.length === 0 && <span className="text-muted">{disabled ? "—" : m.choose}</span>}
      {value.map((v) => (
        <span key={v} title={optionOf.get(v)?.hint} className="inline-flex max-w-full items-center rounded-full border border-border px-2 py-0.5 text-xs" style={optionOf.get(v)?.color ? { borderColor: optionOf.get(v)!.color!, background: `${optionOf.get(v)!.color}26` } : undefined} data-multi-chip={labelOf(v)}>
          <span className="truncate">{labelOf(v)}</span>
        </span>
      ))}
    </span>
  );
  if (disabled) return <div className="flex min-h-9 items-center" data-multi={name}>{chips}</div>;
  return (
    <>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        aria-label={name}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-left text-base hover:border-border-strong md:min-h-9 md:text-sm"
        data-multi={name}
      >
        {chips}
        <Icon name="chevron-down" className="shrink-0 text-muted" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={280}>
          <div className="p-2">
            {options.length > 8 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} aria-label={m.search} autoFocus className="mb-2 min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm" data-multi-search />}
            <ul role="listbox" aria-label={name} aria-multiselectable className="max-h-64 overflow-y-auto">
              {shown.map((o) => (
                <li key={o.value} role="option" aria-selected={value.includes(o.value)}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-hover md:min-h-8" title={o.hint}>
                    <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="h-5 w-5 shrink-0 md:h-4 md:w-4" data-multi-option={o.value} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 truncate text-xs text-muted">{o.hint}</span>}
                  </label>
                </li>
              ))}
              {value.filter(isOther).map((v) => (
                <li key={v} role="option" aria-selected>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-hover md:min-h-8">
                    <input type="checkbox" checked onChange={() => toggle(v)} className="h-5 w-5 shrink-0 md:h-4 md:w-4" />
                    <span className="min-w-0 flex-1 truncate">{otherText(v)}</span>
                    <span className="shrink-0 text-xs text-muted">{m.other}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-1 py-2 text-sm text-muted">{m.nothing}</li>}
            </ul>
            {allowOther && (
              <form
                className="mt-2 flex gap-2 border-t border-border pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = own.trim().slice(0, 60);
                  if (!text) return;
                  if (!value.includes(OTHER + text)) onChange([...value, OTHER + text]);
                  setOwn("");
                }}
              >
                <input value={own} onChange={(e) => setOwn(e.target.value)} maxLength={60} placeholder={m.otherPlaceholder} aria-label={m.otherPlaceholder} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm" data-multi-other />
                <button type="submit" disabled={!own.trim()} className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-50 md:min-h-8" data-multi-other-add>
                  {m.add}
                </button>
              </form>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
