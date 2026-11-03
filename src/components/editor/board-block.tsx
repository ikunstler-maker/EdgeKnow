"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { workspacePath } from "@/lib/paths";
import { readBoard, type BoardData } from "@/lib/boards";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { boardView, boardsForEmbed, createBoard, saveBoard, type BoardSummary, type BoardView } from "@/app/board-actions";

const BoardCanvas = dynamic(() => import("@/components/boards/board-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">{t.boards.embed.loading}</p> });

const e = t.boards.embed;
// The page editor must not see the canvas's keys, clipboard or drops.
const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut", "drop", "dragover", "dragstart", "beforeinput", "input"];

// A board on a wiki page (step Д4). Only its id is stored in the page; what
// shows is read live with the reader's own access. Who may edit the board
// changes it right here (sticky notes, moving, drawing); saved a moment later.
export const boardBlock = createReactBlockSpec(
  {
    type: "boardEmbed",
    propSchema: { boardId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <BoardEmbed boardId={block.props.boardId} pageEditable={editor.isEditable} onPick={(boardId) => editor.updateBlock(block, { props: { boardId } })} />
    ),
    toExternalHTML: () => <p>[{e.title}]</p>,
  },
);

function BoardEmbed({ boardId, pageEditable, onPick }: { boardId: string; pageEditable: boolean; onPick: (id: string) => void }) {
  const pages = useOptionalPages();
  const shortId = pages?.workspace.shortId ?? "";
  const [view, setView] = useState<BoardView | null | undefined>(undefined);
  const [list, setList] = useState<BoardSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  const version = useRef(0);
  const busy = useRef(false);
  // A fresh version read while a change was being saved: looked at again once it is saved.
  const missed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Read now, every 30 seconds while shown and when the tab comes back; a newer
  // version made elsewhere replaces what is shown (unless a change is being saved).
  useEffect(() => {
    if (!shortId || !boardId) return;
    let alive = true;
    boardView(shortId, boardId).then((result) => {
      if (!alive) return;
      if (busy.current) {
        missed.current = true;
        return;
      }
      if (result && result.version === version.current) return;
      version.current = result?.version ?? 0;
      setView(result);
    });
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const poll = setInterval(again, 30_000);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      alive = false;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [shortId, boardId, tick]);
  useEffect(() => {
    if (!boardId && pageEditable && shortId && !list) boardsForEmbed(shortId).then(setList);
  }, [boardId, pageEditable, shortId, list]);

  // The canvas keeps its keys and clipboard to itself.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: Event) => event.stopPropagation();
    for (const name of ISOLATED) element.addEventListener(name, stop);
    return () => {
      for (const name of ISOLATED) element.removeEventListener(name, stop);
    };
  }, [view]);

  const save = (data: BoardData) => {
    if (!view) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const result = await saveBoard(shortId, view.id, null, data, version.current);
        busy.current = false;
        if (missed.current) {
          missed.current = false;
          setTick((n) => n + 1);
        }
        if (result.ok) {
          version.current = result.version;
          setNotice(null);
        } else {
          setNotice(result.error === "conflict" ? e.conflict : (t.boards.errors[result.error] ?? t.common.unknownError));
          version.current = -1;
          setTick((n) => n + 1);
        }
      });
    }, 900);
  };

  let body: React.ReactNode;
  if (!boardId) {
    body = pageEditable ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select defaultValue="" onChange={(event) => event.target.value && onPick(event.target.value)} aria-label={e.choose} className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2">
          <option value="">{e.choose}</option>
          {(list ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              🎨 {item.title || t.boards.untitled}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const made = await createBoard(shortId);
              if (made.ok) onPick(made.id);
              else setNotice(t.boards.errors[made.error] ?? t.common.unknownError);
            })
          }
          className="min-h-9 rounded-md border border-border px-3 hover:bg-surface"
        >
          {t.boards.newBoard}
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted">{e.empty}</p>
    );
  } else if (view === undefined) {
    body = <p className="text-sm text-muted">{e.loading}</p>;
  } else if (view === null) {
    body = <p className="text-sm text-muted">🔒 {e.noAccess}</p>;
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">🎨 {view.title || t.boards.untitled}</span>
          <span className="flex-1" />
          <Link href={workspacePath(shortId, `/boards/${view.id}`)} className="text-sm text-accent hover:underline">
            {e.openEditor} ↗
          </Link>
        </div>
        <div ref={box} className="h-[420px] overflow-hidden rounded-md border border-border" data-board-embed-canvas>
          <BoardCanvas
            key={`${view.id}:${view.version}`}
            shortId={shortId}
            boardId={view.id}
            compact
            initial={readBoard(view.data)}
            editable={view.canEdit}
            onChange={save}
            onPictureError={setNotice}
          />
        </div>
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3" contentEditable={false} data-board-embed={view?.title ?? ""}>
      {body}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
