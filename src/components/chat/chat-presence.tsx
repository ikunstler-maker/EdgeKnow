"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { dateLocale, t } from "@/i18n";
import type { Absence } from "@/lib/time-off";
import { loadAbsences } from "@/app/time-off-actions";
import { Icon } from "@/components/ui/icon";

// "On leave" / "Remote" next to people's names in the chat: today's approved
// absences from Doba, as every member may see them (guests get none from the
// database). Read once and again every ten minutes while the chat is open.

type Away = { remote: boolean; deputy: string | null; until: string };
const AwayContext = createContext<Map<string, Away>>(new Map());

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ChatPresenceProvider({ shortId, workspaceId, guest, children }: { shortId: string; workspaceId: string; guest: boolean; children: ReactNode }) {
  const [away, setAway] = useState<Map<string, Away>>(() => new Map());
  useEffect(() => {
    if (guest) return;
    let live = true;
    const read = async () => {
      const day = today();
      const rows: Absence[] = await loadAbsences(shortId, workspaceId, day, day).catch(() => []);
      if (!live) return;
      const next = new Map<string, Away>();
      // An office absence wins over a remote day when both are there.
      for (const r of rows) if (!next.has(r.user_id) || next.get(r.user_id)!.remote) next.set(r.user_id, { remote: r.remote, deputy: r.deputy, until: r.end_date });
      setAway(next);
    };
    void read();
    const timer = setInterval(() => document.visibilityState === "visible" && void read(), 10 * 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [shortId, workspaceId, guest]);
  return <AwayContext.Provider value={away}>{children}</AwayContext.Provider>;
}

const until = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });

// A small mark after a name; the title tells until when and who stands in.
export function AwayBadge({ userId }: { userId: string | null | undefined }) {
  const away = useContext(AwayContext).get(userId ?? "");
  if (!away) return null;
  const p = t.chat.presence;
  const label = away.remote ? p.remote : p.onLeave;
  const title = [label, p.until(until(away.until)), away.deputy ? p.deputy(away.deputy) : null].filter(Boolean).join(" · ");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium leading-5 ${away.remote ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
      title={title}
      data-chat-away={away.remote ? "remote" : "leave"}
    >
      <Icon name={away.remote ? "monitor" : "sun"} size={11} />
      {label}
    </span>
  );
}
