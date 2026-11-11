"use client";

import { useId, useMemo, useState } from "react";
import { t } from "@/i18n";
import { personLabel, taskKey, type Person, type TaskType } from "@/lib/tasks";
import { Icon } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";
import { Avatar, TypeIcon } from "./task-icons";

const k = t.tasks;
const p = t.tasks.pickers;
// A quiet control of the properties panel: no frame until the pointer or the focus is on it.
export const quietClass =
  "min-h-11 w-full rounded-md border border-transparent bg-transparent px-2 text-left text-sm outline-none transition-colors hover:border-border hover:bg-hover focus:border-accent focus-visible:border-accent disabled:pointer-events-none disabled:opacity-70 md:min-h-8";
const searchClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-accent md:min-h-9";
const optionClass = "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover md:min-h-9";

// People with search and marks instead of a system list. One person (`multiple` off: a
// tap picks and closes, "nobody" clears) or several (a tap adds or removes).
export function PeoplePicker({
  name,
  label,
  members,
  value,
  multiple = false,
  disabled,
  empty,
  onChange,
}: {
  name: string;
  label: string;
  members: Person[];
  value: string[];
  multiple?: boolean;
  disabled?: boolean;
  empty: string;
  onChange: (next: string[]) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const chosen = members.filter((m) => value.includes(m.id));
  const q = query.trim().toLowerCase();
  const shown = q ? members.filter((m) => `${m.name ?? ""} ${m.email}`.toLowerCase().includes(q)) : members;
  const close = () => {
    setAnchor(null);
    setQuery("");
  };
  const pick = (id: string) => {
    if (!multiple) {
      onChange(value[0] === id ? [] : [id]);
      return close();
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${chosen.length ? chosen.map(personLabel).join(", ") : empty}`}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={`${quietClass} flex flex-wrap items-center gap-1 py-1`}
        data-people={name}
      >
        {chosen.length === 0 && <span className="text-muted">{empty}</span>}
        {chosen.map((m) => (
          <span key={m.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-hover py-0.5 pl-0.5 pr-2 text-[13px]" data-person-chip={m.id}>
            <Avatar person={m} size={20} />
            <span className="truncate">{personLabel(m)}</span>
          </span>
        ))}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={280}>
          <div className="p-1" role="listbox" aria-label={label} aria-multiselectable={multiple} data-people-list={name}>
            {members.length > 6 && <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={p.searchPeople} aria-label={p.searchPeople} className={`${searchClass} mb-1`} />}
            {!multiple && value.length > 0 && (
              <button type="button" role="option" aria-selected={false} onClick={() => (onChange([]), close())} className={`${optionClass} text-muted`} data-person-option="">
                <Avatar person={undefined} size={22} />
                {empty}
              </button>
            )}
            {shown.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={value.includes(m.id)} onClick={() => pick(m.id)} className={optionClass} data-person-option={m.id}>
                <Avatar person={m} size={22} />
                <span className="min-w-0 flex-1 truncate">
                  {personLabel(m)}
                  {m.name && <span className="ml-1.5 text-xs text-muted">{m.email}</span>}
                </span>
                {value.includes(m.id) && <Icon name="check" className="shrink-0 text-accent" />}
              </button>
            ))}
            {!shown.length && <p className="px-2 py-3 text-sm text-muted">{p.nobodyFound}</p>}
          </div>
        </Popover>
      )}
    </>
  );
}

const LABEL_TINTS = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
];
// The same label always gets the same colour, in every task of the project.
export const labelTint = (label: string) => {
  let hash = 0;
  for (const ch of label.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return LABEL_TINTS[hash % LABEL_TINTS.length];
};

// Labels as coloured marks; a new one is typed (Enter or a comma adds it), with the
// project's existing labels offered while typing.
export function LabelsEditor({ value, known, disabled, onChange }: { value: string[]; known: string[]; disabled?: boolean; onChange: (next: string[]) => void }) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const next = [...new Set([...value, ...raw.split(",").map((l) => l.trim().slice(0, 40)).filter(Boolean)])].slice(0, 20);
    setDraft("");
    if (next.length !== value.length) onChange(next);
  };
  const offers = known.filter((l) => !value.includes(l));
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1 md:min-h-8" data-labels>
      {value.map((label) => (
        <span key={label} className={`inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 text-xs font-medium ${labelTint(label)} ${disabled ? "pr-2" : "pr-0.5"}`} data-label={label}>
          {label}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((l) => l !== label))} aria-label={p.removeLabel(label)} className="inline-flex h-6 w-6 items-center justify-center rounded-full opacity-70 hover:opacity-100 md:h-4 md:w-4">
              <Icon name="close" size={10} />
            </button>
          )}
        </span>
      ))}
      {!disabled && value.length < 20 && (
        <>
          <input
            value={draft}
            list={listId}
            maxLength={40}
            onChange={(e) => {
              const text = e.target.value;
              // Picking an offered label (or typing a comma) adds it at once.
              if (text.endsWith(",") || offers.includes(text)) add(text);
              else setDraft(text);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => draft.trim() && add(draft)}
            placeholder={value.length ? p.addLabel : p.addFirstLabel}
            aria-label={k.fields.labels}
            className="min-h-9 min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted md:min-h-6"
            data-label-input
          />
          <datalist id={listId}>
            {offers.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </>
      )}
      {disabled && !value.length && <span className="text-sm text-muted">—</span>}
    </div>
  );
}

export type PickTask = { id: string; number: number; title: string; type: TaskType };

// One task of the project chosen by its key or words of its title (the parent task).
export function TaskPicker({
  label,
  projectKey,
  options,
  value,
  empty,
  disabled,
  onChange,
}: {
  label: string;
  projectKey: string;
  options: PickTask[];
  value: string | null;
  empty: string;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const current = options.find((o) => o.id === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q ? options.filter((o) => `${taskKey(projectKey, o.number)} ${o.title}`.toLowerCase().includes(q)) : options;
    return found.slice(0, 50);
  }, [options, projectKey, query]);
  const close = () => {
    setAnchor(null);
    setQuery("");
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${current ? `${taskKey(projectKey, current.number)} ${current.title}` : empty}`}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={`${quietClass} flex items-center gap-1.5`}
        data-parent-picker
      >
        {current ? (
          <>
            <TypeIcon type={current.type} className="shrink-0" />
            <span className="shrink-0 font-mono text-xs text-muted">{taskKey(projectKey, current.number)}</span>
            <span className="truncate">{current.title}</span>
          </>
        ) : (
          <span className="text-muted">{empty}</span>
        )}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={340}>
          <div className="p-1" role="listbox" aria-label={label} data-parent-options>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={p.searchTask} aria-label={p.searchTask} className={`${searchClass} mb-1`} />
            {value && (
              <button type="button" role="option" aria-selected={false} onClick={() => (onChange(null), close())} className={`${optionClass} text-muted`} data-parent-option="">
                {empty}
              </button>
            )}
            {shown.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => (onChange(o.id), close())} className={optionClass} data-parent-option={taskKey(projectKey, o.number)}>
                <TypeIcon type={o.type} className="shrink-0" />
                <span className="shrink-0 font-mono text-xs text-muted">{taskKey(projectKey, o.number)}</span>
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
                {o.id === value && <Icon name="check" className="shrink-0 text-accent" />}
              </button>
            ))}
            {!shown.length && <p className="px-2 py-3 text-sm text-muted">{p.noTaskFound}</p>}
          </div>
        </Popover>
      )}
    </>
  );
}
