"use client";

import { useEffect, useState, useTransition } from "react";
import { dateLocale, t } from "@/i18n";
import { loadMyBirthday, saveMyBirthday } from "@/app/calendar-actions";
import type { MyBirthday } from "@/lib/calendar";
import { buttonClass } from "@/components/ui/button";

const b = t.calendar.birthdays;
const fieldClass = "min-h-11 rounded-lg border border-border bg-background px-2 text-base md:min-h-9 md:text-sm";

// One's own birthday in this workspace: day and month for colleagues, the year only for
// oneself and who manages time off, and whether colleagues see it at all.
export function BirthdayForm({ shortId, workspaceId }: { shortId: string; workspaceId: string }) {
  const [kept, setKept] = useState<MyBirthday | null>(null);
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [shown, setShown] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    loadMyBirthday(shortId, workspaceId).then((value) => {
      if (!alive || !value) return;
      setKept(value);
      setMonth(value.month ? String(value.month) : "");
      setDay(value.day ? String(value.day) : "");
      setYear(value.year ? String(value.year) : "");
      setShown(value.shown);
    });
    return () => {
      alive = false;
    };
  }, [shortId, workspaceId]);

  if (!kept) return null;
  const monthName = (m: number) => new Intl.DateTimeFormat(dateLocale(), { month: "long" }).format(new Date(2000, m - 1, 1));
  const save = (clear = false) =>
    startTransition(async () => {
      setNote(null);
      setFailed(false);
      const value = clear || !month ? { month: null, day: null, year: null } : { month: Number(month), day: Number(day), year: year ? Number(year) : null };
      const result = await saveMyBirthday(shortId, workspaceId, value, shown);
      if (!result.ok) {
        setFailed(true);
        return setNote(b.errors[result.error] ?? b.errors.unknown);
      }
      if (clear) {
        setMonth("");
        setDay("");
        setYear("");
      }
      setNote(b.saved);
    });

  return (
    <section aria-labelledby="my-birthday" className="rounded-xl border border-border bg-surface p-4" data-my-birthday>
      <h2 id="my-birthday" className="text-sm font-semibold">{b.heading}</h2>
      <p className="mt-1 text-xs text-muted">{b.intro}</p>
      {!kept.workspace_on && <p className="mt-2 text-xs text-muted">{b.workspaceOff}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          {b.day}
          <input type="number" inputMode="numeric" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} className={`${fieldClass} w-20`} data-birthday-day />
        </label>
        <label className="flex flex-col text-xs text-muted">
          {b.month}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={fieldClass} data-birthday-month>
            <option value="">{b.noMonth}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted">
          {b.year}
          <input type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} value={year} onChange={(e) => setYear(e.target.value)} className={`${fieldClass} w-24`} data-birthday-year />
        </label>
      </div>
      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={shown} onChange={(e) => setShown(e.target.checked)} data-birthday-shown />
        <span>
          {b.shown}
          <span className="block text-xs text-muted">{b.shownHint}</span>
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || (!!month !== !!day)} onClick={() => save()} className={buttonClass("primary")} data-birthday-save>
          {b.save}
        </button>
        {(kept.month || month) && (
          <button type="button" disabled={pending} onClick={() => save(true)} className={buttonClass("ghost")} data-birthday-clear>
            {b.clear}
          </button>
        )}
        {note && (
          <span role="status" className={`text-sm ${failed ? "text-danger" : "text-muted"}`} data-birthday-note>
            {note}
          </span>
        )}
      </div>
    </section>
  );
}
