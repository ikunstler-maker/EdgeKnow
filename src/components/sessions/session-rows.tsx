"use client";

import { dateLocale, t } from "@/i18n";
import type { SessionItem } from "@/app/session-actions";
import { Icon } from "@/components/ui/icon";

const icon = { phone: "phone", tablet: "phone", computer: "monitor", unknown: "help" } as const;

// "5 min ago", "2 h ago", "3 days ago" in the interface language.
function ago(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(dateLocale(), { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}

const day = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(iso));

// One line per device: its kind, when it signed in and was last active.
export function SessionRows({
  sessions,
  onEnd,
  busy = false,
}: {
  sessions: SessionItem[];
  onEnd?: (session: SessionItem) => void;
  busy?: boolean;
}) {
  const ss = t.sessions;
  if (sessions.length === 0) return <p className="text-sm text-muted">{ss.none}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border" data-sessions>
      {sessions.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-session={x.kind}>
          <Icon name={icon[x.kind]} size={18} className="text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block">
              {ss.kinds[x.kind]}
              {x.current && <span className="ml-2 rounded bg-accent/15 px-1.5 text-xs text-accent">{ss.current}</span>}
            </span>
            <span className="block text-xs text-muted" suppressHydrationWarning>
              {ss.signedIn(day(x.signedInAt))} · {ss.active(ago(x.activeAt))}
            </span>
          </span>
          {onEnd && !x.current && (
            <button type="button" disabled={busy} onClick={() => onEnd(x)} className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60">
              {ss.endOne}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
