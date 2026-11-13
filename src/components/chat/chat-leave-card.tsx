"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { dateLocale, t } from "@/i18n";
import { loadLeaveCard, type ChatLeaveCard } from "@/app/chat-actions";
import { decideLeave } from "@/app/time-off-actions";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/button";

// A time-off request written into the chat by the database: what, when and its state,
// read with the reader's own access; who may decide sees "Approve" and "Decline"
// (decide_leave_request checks the right, as in Doba). Read again every minute while
// shown and after a decision.
const STATUS_CLASS: Record<ChatLeaveCard["status"], string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-surface text-muted",
};

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" });

export function LeaveCard({ shortId, requestId, me, requester }: { shortId: string; requestId: string | null; me: string; requester: string }) {
  const c = t.chat.leave;
  const [card, setCard] = useState<ChatLeaveCard | null | undefined>(requestId ? undefined : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    if (requestId) setCard(await loadLeaveCard(shortId, requestId).catch(() => null));
  }, [shortId, requestId]);
  useEffect(() => {
    if (!requestId) return;
    let live = true;
    void loadLeaveCard(shortId, requestId)
      .catch(() => null)
      .then((found) => live && setCard(found));
    const again = () => document.visibilityState === "visible" && void read();
    const timer = setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [shortId, requestId, read]);

  const decide = async (approve: boolean) => {
    if (!card) return;
    let note = "";
    if (!approve) {
      const asked = window.prompt(c.declineNote);
      if (asked === null) return;
      note = asked.slice(0, 500);
    }
    setBusy(true);
    setError(null);
    const result = await decideLeave(shortId, card.id, approve, note);
    setBusy(false);
    if (!result.ok) setError(c.failed);
    await read();
  };

  return (
    <div className="mt-1 max-w-md rounded-lg border border-border bg-surface/50 p-3 text-sm" data-chat-leave={card?.status ?? (card === null ? "gone" : "loading")}>
      <div className="flex items-center gap-2">
        <Icon name="calendar" size={16} className="text-muted" />
        <span className="font-medium">{requester === me ? c.mine : c.title}</span>
        {card && <span className={`ml-auto rounded-full px-2 text-xs ${STATUS_CLASS[card.status]}`}>{t.timeOff.status[card.status]}</span>}
      </div>
      {card === undefined ? (
        <p className="mt-1 text-muted">{t.chat.loading}</p>
      ) : card === null ? (
        <p className="mt-1 text-muted">{c.gone}</p>
      ) : (
        <>
          <p className="mt-1">
            {card.policy && <span className="font-medium">{card.policy} · </span>}
            {card.start_date === card.end_date ? day(card.start_date) : `${day(card.start_date)} – ${day(card.end_date)}`}
            {card.half && ` (${t.timeOff.half[card.half]})`}
            {` · ${t.timeOff.days(String(card.days))}`}
          </p>
          {card.comment && <p className="mt-1 whitespace-pre-wrap break-words text-muted">{card.comment}</p>}
          {card.decision_note && <p className="mt-1 whitespace-pre-wrap break-words text-muted">{c.note(card.decision_note)}</p>}
          {card.status === "pending" && card.user_id !== me && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void decide(true)} className={buttonClass("primary")} data-chat-leave-approve>
                {c.approve}
              </button>
              <button type="button" disabled={busy} onClick={() => void decide(false)} className={buttonClass("ghost")} data-chat-leave-decline>
                {c.decline}
              </button>
            </div>
          )}
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
          <Link href={`/w/${shortId}/calendar/time-off`} prefetch={false} className="mt-2 inline-block text-xs text-accent hover:underline">
            {c.open}
          </Link>
        </>
      )}
    </div>
  );
}
