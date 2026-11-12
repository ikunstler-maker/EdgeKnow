"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { personLabel, type Person } from "@/lib/tasks";
import { deleteTaskTime, saveTaskTime } from "@/app/task-actions";
import { Icon } from "@/components/ui/icon";

export type TimeEntry = { id: string; user_id: string | null; minutes: number; spent_on: string; note: string | null };

const w = t.tasks.time;
const field = "min-h-11 rounded-md border border-border bg-background px-2 text-base md:min-h-8 md:text-sm";

// "1h 30m", "90m", "1.5", "1,5" (hours) → minutes; null when it is none of these.
export function parseSpent(input: string): number | null {
  const text = input.trim().toLowerCase().replace(",", ".");
  if (!text) return null;
  const plain = /^\d+(\.\d+)?$/.exec(text);
  if (plain) return Math.round(Number(text) * 60) || null;
  const match = /^(?:(\d+(?:\.\d+)?)\s*(?:h|г|год)\.?)?\s*(?:(\d+)\s*(?:m|хв|min)\.?)?$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  return Math.round(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) || null;
}

// Time spent on a task, where the project tracks it: the total next to the estimate, the
// entries the reader may see, and a short form to write down one's own time.
export function TimeLog({ taskId, entries, estimate, members, importedNames, me, canEdit, isOwner }: { taskId: string; entries: TimeEntry[]; estimate: number | null; members: Person[]; importedNames: Record<string, string>; me: string; canEdit: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const left = estimate !== null ? Math.round(estimate * 60) - total : null;
  const who = (e: TimeEntry) => (e.user_id ? personLabel(members.find((m) => m.id === e.user_id)) || t.tasks.someone : importedNames[e.id] ? t.tasks.importer.fromTracker(importedNames[e.id]) : t.tasks.someone);
  const day = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-3 border-t border-border px-2 pt-3" data-task-time>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-muted">{w.heading}</span>
        <span className="text-sm font-medium" data-task-time-total>
          {w.duration(total)}
        </span>
        {left !== null && <span className={`text-xs ${left < 0 ? "text-danger" : "text-muted"}`}>{left < 0 ? w.over(w.duration(-left)) : w.left(w.duration(left))}</span>}
      </div>
      {entries.length > 0 && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-11 text-xs text-muted hover:text-foreground hover:underline md:min-h-8" data-task-time-toggle>
          <Icon name={open ? "chevron-up" : "chevron-down"} className="mr-1 inline" />
          {w.entries(entries.length)}
        </button>
      )}
      {open && (
        <ul className="space-y-1 text-xs" data-task-time-entries>
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2" data-task-time-entry>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{w.duration(e.minutes)}</span> · {who(e)} · {day(e.spent_on)}
                {e.note && <span className="block text-muted">{e.note}</span>}
              </span>
              {(e.user_id === me || isOwner) && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={w.remove}
                  onClick={() => {
                    if (!confirm(w.removeConfirm)) return;
                    startTransition(async () => {
                      const result = await deleteTaskTime(e.id);
                      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
                      router.refresh();
                    });
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-danger md:h-6 md:w-6"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const minutes = parseSpent(String(data.get("spent") ?? ""));
              if (!minutes) return setError(w.badAmount);
              startTransition(async () => {
                const result = await saveTaskTime(taskId, null, minutes, String(data.get("date") || today), String(data.get("note") ?? ""));
                setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
                if (result.ok) {
                  setAdding(false);
                  setOpen(true);
                  router.refresh();
                }
              });
            }}
            data-task-time-form
          >
            <input name="spent" required autoFocus placeholder={w.amount} aria-label={w.amountLabel} className={`${field} w-28`} data-task-time-amount />
            <input name="date" type="date" defaultValue={today} max={today} aria-label={w.date} className={`${field} w-36`} />
            <input name="note" maxLength={500} placeholder={w.note} aria-label={w.note} className={`${field} min-w-0 flex-1 basis-full`} />
            <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-accent px-3 text-sm text-white disabled:opacity-60 md:min-h-8" data-task-time-save>
              {w.save}
            </button>
            <button type="button" onClick={() => (setAdding(false), setError(null))} className="min-h-11 rounded-md border border-border px-3 text-sm md:min-h-8">
              {t.common.cancel}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-1 flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-8" data-task-time-add>
            <Icon name="clock" />
            {w.add}
          </button>
        ))}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
