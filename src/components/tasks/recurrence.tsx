"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { setTaskRecurrence, type RecurrenceRule } from "@/app/task-actions";
import { Icon } from "@/components/ui/icon";

export type TaskRecurrence = { every_n: number; unit: RecurrenceRule["unit"]; weekdays: number[]; next_on: string; until: string | null };

const r = t.tasks.repeat;
const field = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm";
const UNITS = ["day", "week", "month", "year"] as const;

// How a task repeats: every N days, weeks (on chosen days), months or years. On each date
// a copy of the task is made; one done early brings the next at once.
export function Recurrence({ taskId, rule, canEdit }: { taskId: string; rule: TaskRecurrence | null; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [every, setEvery] = useState(String(rule?.every_n ?? 1));
  const [unit, setUnit] = useState<RecurrenceRule["unit"]>(rule?.unit ?? "week");
  const [days, setDays] = useState<number[]>(rule?.weekdays ?? []);
  const [start, setStart] = useState(rule?.next_on ?? "");
  const [until, setUntil] = useState(rule?.until ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const day = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
  const today = new Date().toISOString().slice(0, 10);
  const save = (next: RecurrenceRule | null) =>
    startTransition(async () => {
      const result = await setTaskRecurrence(taskId, next);
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  if (!rule && !canEdit) return null;
  return (
    <div className="mt-3 border-t border-border px-2 pt-3" data-task-repeat>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-muted">{r.heading}</span>
        <span className="text-sm" data-task-repeat-summary>
          {rule ? `${r.every(rule.every_n, rule.unit)}${rule.weekdays.length ? ` (${rule.weekdays.map((d) => r.weekdays[d - 1]).join(", ")})` : ""} · ${r.next(day(rule.next_on))}` : r.none}
        </span>
      </div>
      {canEdit && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-1 flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-8" data-task-repeat-open>
          <Icon name="refresh" />
          {rule ? r.change : r.set}
        </button>
      )}
      {canEdit && open && (
        <form
          className="mt-2 space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save({ every: Math.max(1, Math.round(Number(every) || 1)), unit, weekdays: unit === "week" ? days : [], start: start || null, until: until || null });
          }}
          data-task-repeat-form
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>{r.everyLabel}</span>
            <input type="number" min={1} max={366} required value={every} onChange={(e) => setEvery(e.target.value)} aria-label={r.count} className={`${field} w-20`} data-task-repeat-every />
            <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceRule["unit"])} aria-label={r.unit} className={field} data-task-repeat-unit>
              {UNITS.map((value) => (
                <option key={value} value={value}>
                  {r.units[value]}
                </option>
              ))}
            </select>
          </div>
          {unit === "week" && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={r.onDays}>
              {r.weekdays.map((name, index) => {
                const on = days.includes(index + 1);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays(on ? days.filter((d) => d !== index + 1) : [...days, index + 1].sort())}
                    className={`min-h-11 min-w-11 rounded-md border px-2 text-xs md:min-h-8 md:min-w-8 ${on ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
                    data-task-repeat-day={index + 1}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {r.start}
              <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className={`${field} text-foreground`} data-task-repeat-start />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {r.until}
              <input type="date" min={start || today} value={until} onChange={(e) => setUntil(e.target.value)} className={`${field} text-foreground`} />
            </label>
          </div>
          <p className="text-xs text-muted">{r.hint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-accent px-3 text-white disabled:opacity-60 md:min-h-8" data-task-repeat-save>
              {r.save}
            </button>
            {rule && (
              <button type="button" disabled={pending} onClick={() => confirm(r.stopConfirm) && save(null)} className="min-h-11 rounded-md border border-border px-3 text-danger md:min-h-8" data-task-repeat-stop>
                {r.stop}
              </button>
            )}
            <button type="button" onClick={() => (setOpen(false), setError(null))} className="min-h-11 rounded-md border border-border px-3 md:min-h-8">
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
