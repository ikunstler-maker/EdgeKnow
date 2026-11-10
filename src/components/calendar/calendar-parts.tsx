"use client";

import { useEffect, useMemo, useState } from "react";
import { dateLocale, t } from "@/i18n";
import { dropFeed, issueFeed, loadFeed, saveCalendarSettings } from "@/app/calendar-actions";
import { browserTimeZone, timeZones, type CalendarPerson, type CalendarSettings } from "@/lib/calendar";

const c = t.calendar;
export const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";
export const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";
export const primaryClass = "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 md:min-h-9";

// People as chips with a search box: for the invited and for "whose time to show".
export function PeoplePicker({
  label,
  hint,
  people,
  picked,
  onChange,
  max = 200,
  locked = [],
}: {
  label: string;
  hint?: string;
  people: CalendarPerson[];
  picked: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  // Shown as chips that can't be removed (the organizer).
  locked?: string[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => !picked.includes(p.id) && !locked.includes(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 8);
  }, [people, picked, locked, query]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const add = (id: string) => {
    if (picked.length < max) onChange([...picked, id]);
    setQuery("");
    setOpen(false);
  };
  return (
    <div data-people-picker={label}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-muted">{label}:</span>
        {locked.map((id) => (
          <span key={id} className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface px-2 text-sm">
            {nameOf(id)}
          </span>
        ))}
        {picked.map((id) => (
          <span key={id} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface pl-2 text-sm" data-picked={nameOf(id)}>
            {nameOf(id)}
            <button type="button" onClick={() => onChange(picked.filter((p) => p !== id))} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-background" aria-label={c.form.removePerson(nameOf(id))}>
              ✕
            </button>
          </span>
        ))}
        <span className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (found[0]) add(found[0].id);
              }
            }}
            placeholder={c.form.addPeople}
            aria-label={`${label}: ${c.form.addPeople}`}
            className="min-h-11 w-44 rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm"
          />
          {open && (
            <ul className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 max-w-[80vw] overflow-y-auto rounded-md border border-border bg-background py-1 shadow-lg">
              {found.length === 0 && <li className="px-3 py-2 text-sm text-muted">{c.form.noPeopleFound}</li>}
              {found.map((p) => (
                <li key={p.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(p.id)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface md:min-h-9" data-person-option={p.name}>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.guest && <span className="text-xs text-muted">{c.form.guestMark}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
      {hint && picked.length === 0 && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// Working days and the time zone new events start with (owner and admins).
export function CalendarSettingsDialog({
  shortId,
  workspaceId,
  settings,
  onSaved,
  onClose,
}: {
  shortId: string;
  workspaceId: string;
  settings: CalendarSettings;
  onSaved: (settings: CalendarSettings) => void;
  onClose: () => void;
}) {
  const [workDays, setWorkDays] = useState(settings.work_days);
  const [zone, setZone] = useState(settings.time_zone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones([settings.time_zone, browserTimeZone()]), [settings.time_zone]);
  const s = c.settings;
  const save = async () => {
    setSaving(true);
    const next = { work_days: [...workDays].sort(), time_zone: zone };
    const result = await saveCalendarSettings(shortId, workspaceId, next);
    setSaving(false);
    if (!result.ok) return setError(c.errors[result.error] ?? c.errors.unknown);
    onSaved(next);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
        data-calendar-settings
      >
        <h2 className="text-lg font-semibold">{s.title}</h2>
        <fieldset className="mt-3">
          <legend className="text-sm text-muted">{s.workDays}</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <label key={day} className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm ${workDays.includes(day) ? "border-accent bg-accent text-white" : "border-border"}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={workDays.includes(day)}
                  onChange={(e) => setWorkDays(e.target.checked ? [...workDays, day] : workDays.filter((d) => d !== day))}
                />
                {s.days[day - 1]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-3 block text-sm">
          <span className="text-muted">{s.timeZone}</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className={`${inputClass} mt-1`}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            {c.form.cancel}
          </button>
          <button type="button" onClick={save} disabled={saving || workDays.length === 0} className={primaryClass}>
            {c.form.save}
          </button>
        </div>
      </div>
    </div>
  );
}

// The person's own feed for calendar apps (phase 3a): on / off / a new address. The
// address is shown once, right after it is made — only its hash is kept.
export function FeedDialog({ shortId, workspaceId, onClose }: { shortId: string; workspaceId: string; onClose: () => void }) {
  const f = c.feed;
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadFeed(shortId, workspaceId).then((feed) => {
      if (alive) setSince(feed?.since ?? null);
    });
    return () => {
      alive = false;
    };
  }, [shortId, workspaceId]);
  const issue = async () => {
    setBusy(true);
    setError(null);
    const result = await issueFeed(shortId, workspaceId);
    setBusy(false);
    if (!result.ok) return setError(c.errors[result.error] ?? c.errors.unknown);
    setAddress(`${window.location.origin}${result.path}`);
    setSince(new Date().toISOString());
    setCopied(false);
  };
  const drop = async () => {
    if (!window.confirm(f.dropConfirm)) return;
    setBusy(true);
    setError(null);
    const result = await dropFeed(shortId, workspaceId);
    setBusy(false);
    if (!result.ok) return setError(c.errors[result.error] ?? c.errors.unknown);
    setAddress(null);
    setSince(null);
  };
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // No clipboard access: the address stays selectable in the field.
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={f.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
        data-calendar-feed
      >
        <h2 className="text-lg font-semibold">{f.title}</h2>
        <p className="mt-2 text-sm">{f.intro}</p>
        <p className="mt-1 text-sm text-muted">{f.what}</p>
        {since !== undefined && (
          <p className="mt-3 text-sm" data-feed-state={since ? "on" : "off"}>
            {since ? f.on(new Date(since).toLocaleDateString(dateLocale())) : f.off}
          </p>
        )}
        {address && (
          <div className="mt-3 rounded-md border border-accent/50 bg-accent/5 p-3">
            <p className="text-sm font-medium">{f.once}</p>
            <div className="mt-2 flex gap-2">
              <input readOnly value={address} onFocus={(e) => e.target.select()} aria-label={f.title} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm md:min-h-9" data-feed-address />
              <button type="button" onClick={copy} className={buttonClass}>
                {copied ? f.copied : f.copy}
              </button>
            </div>
            <p className="mt-2 text-sm text-danger">{f.secret}</p>
            <p className="mt-1 text-sm text-muted">{f.how}</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {since && !address && <p className="mt-2 text-sm text-muted">{f.renewHint}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            {f.close}
          </button>
          {since && (
            <button type="button" onClick={drop} disabled={busy} className={buttonClass} data-feed-drop>
              {f.drop}
            </button>
          )}
          {since !== undefined && (
            <button type="button" onClick={issue} disabled={busy} className={primaryClass} data-feed-issue>
              {since ? f.renew : f.create}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
