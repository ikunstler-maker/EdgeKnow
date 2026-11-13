"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { TEMPLATE_KEYS } from "@/lib/board-templates";
import { workspacePath } from "@/lib/paths";
import { boardSession, createTaskFromSticky, setBoardTimer, setBoardVoting, toggleBoardVote, type BoardSession } from "@/app/board-actions";
import { projectsForEmbed, taskChips, type ChipProject } from "@/app/task-wiki-actions";
import type { BoardController, StickyInfo } from "./board-canvas";
import { wishlistEmbedView } from "@/app/wishlist-actions";
import { WishlistPicker } from "@/components/wishlists/wishlist-embed";
import { VaultFilePicker } from "@/components/files/vault-file-embed";
import { vaultFileHref } from "@/lib/vault-links";
import { Icon } from "@/components/ui/icon";

const b = t.boards;
const button = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[13px] font-medium hover:bg-hover disabled:opacity-50 md:h-8 md:min-h-0";
const MINUTES = [1, 3, 5, 10, 15];

export type SessionView = { votes: { open: boolean; tally: Record<string, number>; mine: string[]; show: boolean } | null; chips: Record<string, { key: string; done: boolean; status: string } | null> };

// Above the board (step Д3a): templates, voting, the shared timer and a task
// from the selected sticky note. Everyone on the board reads the same session
// every few seconds (live updates come with step Д2).
export function useBoardSession(shortId: string, id: string, stickies: StickyInfo[]) {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [offset, setOffset] = useState(0);
  const [chips, setChips] = useState<SessionView["chips"]>({});

  const refresh = useCallback(async () => {
    const next = await boardSession(shortId, id).catch(() => null);
    if (next) {
      setSession(next);
      setOffset(new Date(next.now).getTime() - Date.now());
    }
  }, [shortId, id]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const again = () => document.visibilityState === "visible" && void refresh();
    const timer = setInterval(again, 4000);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [refresh]);

  // Task chips on sticky notes: their status, read now and every 30 seconds.
  const taskIds = stickies.flatMap((s) => (s.task ? [s.task.id] : [])).sort().join(",");
  useEffect(() => {
    if (!taskIds) return;
    const load = async () => {
      const found = await taskChips(shortId, taskIds.split(",")).catch(() => null);
      if (!found) return;
      const byId = new Map(found.map((task) => [task.id, task]));
      setChips(Object.fromEntries(taskIds.split(",").map((tid) => [tid, byId.has(tid) ? { key: byId.get(tid)!.key, done: byId.get(tid)!.category === "done", status: byId.get(tid)!.status } : null])));
    };
    void load();
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => clearInterval(timer);
  }, [shortId, taskIds]);

  return { session, setSession, offset, refresh, chips };
}

export function BoardSessionBar({
  shortId,
  id,
  title,
  role,
  controller,
  stickies,
  selected,
  state,
  showResults,
  setShowResults,
}: {
  shortId: string;
  id: string;
  title: string;
  role: string;
  controller: BoardController | null;
  stickies: StickyInfo[];
  selected: string | null;
  state: ReturnType<typeof useBoardSession>;
  showResults: boolean;
  setShowResults: (show: boolean) => void;
}) {
  const canEdit = role === "owner" || role === "editor";
  const { session, offset, refresh } = state;
  const [menu, setMenu] = useState<"templates" | "voting" | "timer" | "task" | "keys" | "wishlist" | "vault" | null>(null);
  const [votes, setVotes] = useState(3);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ChipProject[] | null>(null);
  const [project, setProject] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const rang = useRef<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await action().catch(() => ({ ok: false, error: "unknown" }));
    setBusy(false);
    setNotice(result.ok ? null : (b.errors[result.error ?? ""] ?? t.common.unknownError));
    setMenu(null);
    await refresh();
    return result;
  };

  // The countdown, on the server's clock.
  const endsAt = session?.timerEndsAt ? new Date(session.timerEndsAt).getTime() : null;
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [endsAt]);
  const left = endsAt ? Math.max(0, Math.round((endsAt - (now + offset)) / 1000)) : null;
  const finished = left === 0 && endsAt !== null && now + offset - endsAt < 15_000;
  useEffect(() => {
    if (!finished || !session?.timerEndsAt || rang.current === session.timerEndsAt) return;
    rang.current = session.timerEndsAt;
    try {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 1.2);
      tone.connect(gain).connect(audio.destination);
      tone.start();
      tone.stop(audio.currentTime + 1.2);
    } catch {
      // No sound on this device; the text says it.
    }
  }, [finished, session?.timerEndsAt]);
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  const myLeft = session?.votesPerPerson ? session.votesPerPerson - session.mine.length : 0;
  const sticky = stickies.find((s) => s.id === selected) ?? null;
  const ranked = [...stickies].map((s) => ({ ...s, n: session?.tally[s.id] ?? 0 })).filter((s) => s.n > 0).sort((x, y) => y.n - x.n);

  return (
    // One floating dock over the canvas: templates, voting, the timer, a task from a sticky note, the keys.
    <div className="absolute bottom-20 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border-strong bg-overlay/85 p-1.5 shadow-2xl backdrop-blur-md empty:hidden md:bottom-4" data-board-session>
      {canEdit && (
        <div className="relative">
          <button type="button" className={button} onClick={() => setMenu(menu === "templates" ? null : "templates")} aria-expanded={menu === "templates"}>
            {b.templates.button}
          </button>
          {menu === "templates" && (
            <div className="absolute left-0 bottom-full z-20 mb-2 w-64 rounded-lg border border-border bg-background p-1 shadow-lg" role="menu">
              {TEMPLATE_KEYS.map((key) => (
                <button key={key} type="button" role="menuitem" className="block min-h-10 w-full rounded px-3 text-left text-sm hover:bg-surface" onClick={() => { controller?.insertTemplate(key); setMenu(null); }}>
                  {b.templates.names[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {canEdit && (
        <div className="relative">
          <button type="button" className={button} onClick={() => setMenu(menu === "wishlist" ? null : "wishlist")} aria-expanded={menu === "wishlist"} data-board-wishlist>
            <Icon name="gift" className="mr-1 inline" />
            {t.wishlists.embed.addToBoard}
          </button>
          {menu === "wishlist" && (
            <div className="absolute left-0 bottom-full z-20 mb-2 w-80 max-w-[calc(100vw-2rem)]">
              <WishlistPicker
                shortId={shortId}
                onPick={async (id) => {
                  setMenu(null);
                  const view = await wishlistEmbedView(shortId, id);
                  if (view) controller?.insertLink(t.wishlists.embed.boardLink(view.ownerName), workspacePath(shortId, `/wishlists/${view.id}`), view.design.accent);
                }}
              />
            </div>
          )}
        </div>
      )}
      {canEdit && (
        <div className="relative">
          <button type="button" className={button} onClick={() => setMenu(menu === "vault" ? null : "vault")} aria-expanded={menu === "vault"} data-board-vault>
            <Icon name="folder" className="mr-1 inline" />
            {t.vault.embed.fromVault}
          </button>
          {menu === "vault" && (
            <div className="absolute left-0 bottom-full z-20 mb-2 w-80 max-w-[calc(100vw-2rem)]">
              {/* Only "File from Vault" is written on the board, never the file's name. */}
              <VaultFilePicker
                shortId={shortId}
                onPick={(id) => {
                  setMenu(null);
                  controller?.insertLink(t.vault.embed.boardLink, vaultFileHref(shortId, id), "#94A3B8");
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Voting */}
      {session?.votingOpen ? (
        <span className="flex flex-wrap items-center gap-2 rounded-md bg-accent/10 px-2 py-1 text-sm" data-voting-open>
          <span><Icon name="vote" className="mr-1.5 inline" />{b.voting.left(myLeft, session.votesPerPerson ?? 0)}</span>
          <span className="hidden text-xs text-muted lg:inline">{b.voting.hint}</span>
          {canEdit && (
            <button type="button" disabled={busy} className={button} onClick={() => void run(() => setBoardVoting(shortId, id, null)).then(() => setShowResults(true))}>
              {b.voting.finish}
            </button>
          )}
        </span>
      ) : (
        canEdit && (
          <div className="relative">
            <button type="button" className={button} onClick={() => setMenu(menu === "voting" ? null : "voting")} aria-expanded={menu === "voting"}>
              {b.voting.start}
            </button>
            {menu === "voting" && (
              <div className="absolute left-0 bottom-full z-20 mb-2 flex w-64 flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-3 shadow-lg">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {b.voting.votesEach}
                  <select value={votes} onChange={(e) => setVotes(Number(e.target.value))} className="min-h-10 rounded-md border border-border bg-background px-2">
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={busy} className={button} onClick={() => void run(() => setBoardVoting(shortId, id, votes)).then(() => setShowResults(false))}>
                  {b.voting.begin}
                </button>
              </div>
            )}
          </div>
        )
      )}
      {session && Object.keys(session.tally).length > 0 && (
        <button type="button" className={button} onClick={() => setShowResults(!showResults)} aria-pressed={showResults}>
          <Icon name="chart" className="mr-1 inline" />
          {b.voting.results}
        </button>
      )}

      {/* Timer */}
      {left !== null && (left > 0 || finished) ? (
        <span className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium ${finished ? "bg-danger/10 text-danger" : "bg-surface"}`} role="timer" data-board-timer={left}>
          {finished ? b.timer.done : b.timer.left(clock(left))}
          {canEdit && !finished && (
            <button type="button" disabled={busy} className={button} onClick={() => void run(() => setBoardTimer(shortId, id, null))}>
              {b.timer.stop}
            </button>
          )}
        </span>
      ) : (
        canEdit && (
          <div className="relative">
            <button type="button" className={button} onClick={() => setMenu(menu === "timer" ? null : "timer")} aria-expanded={menu === "timer"}>
              {b.timer.button}
            </button>
            {menu === "timer" && (
              <div className="absolute left-0 bottom-full z-20 mb-2 flex gap-1 rounded-lg border border-border bg-background p-2 shadow-lg">
                {MINUTES.map((m) => (
                  <button key={m} type="button" disabled={busy} className={button} onClick={() => void run(() => setBoardTimer(shortId, id, m * 60))}>
                    {b.timer.minutes(m)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* A task from the selected sticky note */}
      {canEdit && (
        <div className="relative">
          <button
            type="button"
            className={button}
            disabled={!sticky || Boolean(sticky.task)}
            title={sticky ? undefined : b.task.hint}
            onClick={async () => {
              setMenu(menu === "task" ? null : "task");
              if (!projects) {
                const list = (await projectsForEmbed(shortId).catch(() => [])).filter((p) => p.canEdit);
                setProjects(list);
                setProject(list[0]?.id ?? "");
              }
            }}
          >
            {b.task.button}
          </button>
          {menu === "task" && sticky && (
            <div className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-lg border border-border border border-border-strong bg-overlay p-3 shadow-lg" role="dialog" aria-label={b.task.title}>
              <p className="text-sm font-medium">{b.task.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{sticky.text || b.voting.untitledSticky}</p>
              {projects && projects.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{b.task.noProjects}</p>
              ) : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {b.task.project}
                    <select value={project} onChange={(e) => setProject(e.target.value)} className="min-h-10 rounded-md border border-border bg-background px-2">
                      {(projects ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.icon ? `${p.icon} ` : ""}{p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !project}
                    className={button}
                    onClick={async () => {
                      const result = await run(() => createTaskFromSticky(shortId, project, sticky.text, id, title));
                      if (result.ok && "id" in result) {
                        const made = result as unknown as { id: string; key: string };
                        const key = made.key;
                        const projectKey = key.split("-")[0];
                        controller?.linkTask(sticky.id, { id: made.id, key, href: workspacePath(shortId, `/tasks/${projectKey}/${key.split("-")[1]}`) });
                        setNotice(b.task.created(key));
                      }
                    }}
                  >
                    {b.task.create}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="relative">
          <button type="button" className={button} onClick={() => setMenu(menu === "keys" ? null : "keys")} aria-expanded={menu === "keys"} aria-label={b.keys} title={b.keys} data-board-keys>
            <Icon name="keyboard" />
          </button>
          {menu === "keys" && (
            <ul className="absolute bottom-full right-0 z-20 mb-2 w-56 space-y-1 rounded-xl border border-border-strong bg-overlay p-3 text-xs shadow-xl" aria-label={b.keys}>
              {b.hints.split(" · ").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="order-first w-full px-2 text-center text-sm text-muted">
          {notice}
        </p>
      )}

      {showResults && session && (
        <section className="order-first max-h-64 w-full overflow-y-auto rounded-xl border border-border p-3 text-sm" aria-label={b.voting.resultsTitle} data-vote-results>
          <p className="font-medium">
            {b.voting.resultsTitle} · {b.voting.voters(session.voters)}
            {!session.votingOpen && ` · ${b.voting.closed}`}
          </p>
          {ranked.length === 0 ? (
            <p className="mt-1 text-muted">{b.voting.noVotes}</p>
          ) : (
            <ol className="mt-2 space-y-1">
              {ranked.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="min-w-8 rounded-full bg-accent px-2 text-center text-xs font-semibold text-white">{s.n}</span>
                  <span className="truncate">{s.text || b.voting.untitledSticky}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

export async function voteFor(shortId: string, id: string, stickyId: string) {
  return toggleBoardVote(shortId, id, stickyId);
}
