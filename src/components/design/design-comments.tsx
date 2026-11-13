"use client";

import { useCallback, useEffect, useState } from "react";
import { dateLocale, t } from "@/i18n";
import { addDesignComment, deleteDesignComment, designComments, resolveDesignComment, type DesignComment } from "@/app/board-actions";

// BORDY-1: comments pinned on a "Design" canvas — the pins on the page, and the panel with the
// threads, replies, "Resolved" and delete. What one may do is decided by the database.

const c = t.design.comments;

export function useDesignComments(shortId: string, fileId: string, enabled: boolean) {
  const [list, setList] = useState<DesignComment[]>([]);
  const reload = useCallback(async () => {
    const found = await designComments(shortId, fileId).catch(() => null);
    if (found) setList(found);
  }, [shortId, fileId]);
  useEffect(() => {
    if (!enabled) return;
    // Read once on opening (the answer arrives later), then every 30 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const timer = setInterval(() => document.visibilityState === "visible" && void reload(), 30_000);
    return () => clearInterval(timer);
  }, [enabled, reload]);
  return { list, reload };
}

// The page's open threads as numbered pins (document coordinates; `unit` is one screen pixel).
export function CommentPins({ threads, unit, active, onPick }: { threads: DesignComment[]; unit: number; active: string | null; onPick: (id: string) => void }) {
  return (
    <g data-comment-pins>
      {threads.map((thread, i) => (
        <g
          key={thread.id}
          transform={`translate(${thread.x} ${thread.y}) scale(${unit})`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPick(thread.id);
          }}
          className="cursor-pointer"
          data-comment-pin={i + 1}
        >
          <path d="M0,0 L0,-22 Q0,-30 8,-30 L22,-30 Q30,-30 30,-22 L30,-8 Q30,0 22,0 Z" fill={active === thread.id ? "#f59e0b" : thread.resolved_at ? "#6b7280" : "#38bdf8"} stroke="#fff" strokeWidth={1.5} />
          <text x={15} y={-10} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0b0f14">
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CommentsPanel({
  shortId,
  fileId,
  pageId,
  list,
  reload,
  pending,
  onPendingDone,
  active,
  onActive,
  canComment,
}: {
  shortId: string;
  fileId: string;
  pageId: string;
  list: DesignComment[];
  reload: () => Promise<void>;
  pending: { x: number; y: number; node: string | null } | null;
  onPendingDone: () => void;
  active: string | null;
  onActive: (id: string | null) => void;
  canComment: boolean;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threads = list.filter((x) => !x.parent_id && x.page_id === pageId && (showResolved || !x.resolved_at));
  const run = async (action: () => Promise<{ ok: boolean; error?: string } | { ok: false; error: string }>) => {
    setError(null);
    const result = await action();
    if (!result.ok) setError(c.errors[(result as { error: string }).error] ?? t.common.unknownError);
    await reload();
    return result.ok;
  };
  const box = "w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm";
  const btn = "min-h-11 rounded-md border border-white/15 px-2 text-xs hover:bg-white/10 md:min-h-8";
  return (
    <div className="space-y-3" data-comments-panel>
      <div className="flex items-center justify-between">
        <p className="font-medium">{c.title}</p>
        <label className="flex items-center gap-1 text-xs text-gray-400">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {c.showResolved}
        </label>
      </div>
      {canComment && pending && (
        <form
          className="space-y-2 rounded-lg border border-sky-500/40 p-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            if (await run(() => addDesignComment(shortId, fileId, pageId, pending.x, pending.y, pending.node, text))) {
              setText("");
              onPendingDone();
            }
          }}
          data-comment-new
        >
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder={c.placeholder} className={box} aria-label={c.placeholder} />
          <div className="flex gap-1">
            <button type="submit" className={`${btn} bg-sky-500/30`} data-comment-send>
              {c.send}
            </button>
            <button type="button" className={btn} onClick={onPendingDone}>
              {c.cancel}
            </button>
          </div>
        </form>
      )}
      {!threads.length && !pending && <p className="text-xs text-gray-400">{canComment ? c.emptyHint : c.empty}</p>}
      <ol className="space-y-2">
        {threads.map((thread) => {
          const replies = list.filter((x) => x.parent_id === thread.id);
          const open = active === thread.id;
          return (
            <li key={thread.id} className={`rounded-lg border p-2 ${open ? "border-amber-400/60" : "border-white/10"} ${thread.resolved_at ? "opacity-70" : ""}`} data-comment-thread={thread.body}>
              <button type="button" className="block w-full text-left" onClick={() => onActive(open ? null : thread.id)}>
                <p className="text-xs text-gray-400">
                  {thread.author || c.someone} · {when(thread.created_at)}
                  {thread.resolved_at && ` · ${c.resolved}`}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{thread.body}</p>
              </button>
              {open && (
                <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                  {replies.map((r) => (
                    <div key={r.id} className="text-sm" data-comment-reply>
                      <p className="text-xs text-gray-400">
                        {r.author || c.someone} · {when(r.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{r.body}</p>
                    </div>
                  ))}
                  {canComment && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!reply.trim()) return;
                        if (await run(() => addDesignComment(shortId, fileId, pageId, thread.x, thread.y, null, reply, thread.id))) setReply("");
                      }}
                    >
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={4000} placeholder={c.reply} className={box} aria-label={c.reply} data-comment-reply-box />
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button type="submit" className={btn} data-comment-reply-send>
                          {c.send}
                        </button>
                        <button type="button" className={btn} onClick={() => void run(() => resolveDesignComment(shortId, thread.id, !thread.resolved_at))} data-comment-resolve>
                          {thread.resolved_at ? c.reopen : c.resolve}
                        </button>
                        <button type="button" className={`${btn} text-red-300`} onClick={() => void run(() => deleteDesignComment(shortId, thread.id))} data-comment-delete>
                          {c.delete}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
