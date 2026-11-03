"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { t } from "@/i18n";
import { ancestorsOf } from "@/lib/pages";
import { pagePath, workspacePath } from "@/lib/paths";
import { searchBlocks, searchPages, type BlockHit, type BlockKind, type SearchHit } from "@/app/page-actions";
import { searchNodeObjects, type NodeObjectHit } from "@/app/node-actions";
import { searchBoards, type BoardHit } from "@/app/board-actions";
import { usePages } from "@/components/pages/pages-provider";

const s = t.search;
// Labels are read when shown, in the current language.
const DEPTHS = [
  { value: "0", label: () => s.depths.level },
  { value: "1", label: () => s.depths.one },
  { value: "2", label: () => s.depths.two },
  { value: "all", label: () => s.depths.all },
];

// Matches arrive marked with \u0001…\u0002 and are shown as <mark>, the rest as text.
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <span className="line-clamp-2 text-xs text-muted">
      {parts.map((part, i) =>
        part.startsWith("\u0001") ? (
          <mark key={i} className="rounded bg-[var(--comment)] px-0.5 text-foreground">
            {part.slice(1, -1)}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}

export function SearchButton({ currentPageId, onNavigate }: { currentPageId: string | null; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);

  // Ctrl+K / Cmd+K anywhere opens search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface hover:text-foreground md:min-h-9"
      >
        <span className="w-5 text-center">🔍</span>
        <span className="flex-1 text-left">{s.button}</span>
        <kbd className="hidden rounded border border-border px-1 text-[10px] md:inline">Ctrl K</kbd>
      </button>
      {open && (
        <SearchDialog
          currentPageId={currentPageId}
          onClose={() => setOpen(false)}
          onNavigate={() => {
            setOpen(false);
            onNavigate?.();
          }}
        />
      )}
    </>
  );
}

function SearchDialog({
  currentPageId,
  onClose,
  onNavigate,
}: {
  currentPageId: string | null;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const { workspace, pages } = usePages();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"workspace" | "page">("workspace");
  const [depth, setDepth] = useState("all");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  // "" lets the words decide; "text" is plain text search even for "картинка".
  const [kind, setKind] = useState<BlockKind | "" | "text" | "maps" | "boards">("");
  const [blockHits, setBlockHits] = useState<BlockHit[] | null>(null);
  // Maps and diagrams of the node space (step Н3): their own chip, and below page results.
  const [mapHits, setMapHits] = useState<NodeObjectHit[] | null>(null);
  const mapsMode = kind === "maps";
  // Boards (step Д4): the same, with the text of sticky notes and frames.
  const [boardHits, setBoardHits] = useState<BoardHit[] | null>(null);
  const boardsMode = kind === "boards";
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);
  const currentPage = currentPageId ? pages.find((p) => p.id === currentPageId) : undefined;
  const effectiveScope = currentPage ? scope : "workspace";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // A kind chosen with a button, or said in words: "картинка", "заголовки бюджет"…
  const said = kind ? null : detectKind(query);
  const activeKind: BlockKind | "" = kind === "text" || kind === "maps" || kind === "boards" ? "" : kind || said?.kind || "";
  const words = said ? said.rest : query.trim();

  // Searches after a short pause in typing; only the latest answer is shown.
  useEffect(() => {
    const id = ++latest.current;
    const timer = setTimeout(() => {
      const root = effectiveScope === "page" ? (currentPageId ?? null) : null;
      const levels = depth === "all" ? null : Number(depth);
      if (boardsMode) {
        startTransition(async () => {
          const result = await searchBoards(workspace.shortId, words);
          if (id === latest.current) setBoardHits(result);
        });
        return;
      }
      if (mapsMode) {
        startTransition(async () => {
          const result = await searchNodeObjects(workspace.shortId, words);
          if (id === latest.current) setMapHits(result);
        });
        return;
      }
      if (activeKind) {
        startTransition(async () => {
          const result = await searchBlocks(workspace.id, activeKind, words, root, levels);
          if (id === latest.current) setBlockHits(result);
        });
        return;
      }
      if (!words) return;
      startTransition(async () => {
        const [result, maps, boards] = await Promise.all([
          searchPages(workspace.id, words, root, levels),
          effectiveScope === "workspace" ? searchNodeObjects(workspace.shortId, words) : Promise.resolve([]),
          effectiveScope === "workspace" ? searchBoards(workspace.shortId, words) : Promise.resolve([]),
        ]);
        if (id === latest.current) {
          setHits(result);
          setMapHits(maps.slice(0, 5));
          setBoardHits(boards.slice(0, 5));
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [words, activeKind, mapsMode, boardsMode, effectiveScope, depth, workspace.id, workspace.shortId, currentPageId]);

  const shown = !activeKind && !mapsMode && !boardsMode && query.trim() ? hits : null;
  const boardList = (list: BoardHit[]) => (
    <ul aria-label={s.boardResults} data-board-results>
      {list.map((hit) => (
        <li key={hit.id}>
          <Link href={workspacePath(workspace.shortId, `/boards/${hit.id}`)} onClick={onNavigate} className="flex gap-3 rounded-md px-3 py-2 hover:bg-surface">
            <span className="shrink-0 text-lg">🎨</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{hit.title || t.boards.untitled}</span>
              {hit.snippet && <span className="block truncate text-xs text-muted">{hit.snippet}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const mapList = (list: NodeObjectHit[]) => (
    <ul aria-label={s.mapResults} data-map-results>
      {list.map((hit) => (
        <li key={hit.id}>
          <Link href={workspacePath(workspace.shortId, `/nodes/${hit.id}`)} onClick={onNavigate} className="flex gap-3 rounded-md px-3 py-2 hover:bg-surface">
            <span className="shrink-0 text-lg">{hit.kind === "flow" ? "🔀" : "🧠"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{hit.title || t.nodes.untitled}</span>
              {hit.snippet && <span className="block truncate text-xs text-muted">{hit.snippet}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[75vh] w-full max-w-xl flex-col rounded-xl bg-background shadow-xl"
      >
        <div className="border-b border-border p-3">
          <input
            autoFocus
            type="search"
            value={query}
            maxLength={200}
            placeholder={s.placeholder}
            aria-label={s.placeholder}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-base"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <label className="flex items-center gap-1">
              {s.scope}
              <select
                value={effectiveScope}
                onChange={(event) => setScope(event.target.value as "workspace" | "page")}
                className="min-h-9 rounded-md border border-border bg-background px-1 text-sm text-foreground"
              >
                <option value="workspace">{s.scopes.workspace}</option>
                {currentPage && <option value="page">{s.scopes.page(currentPage.title || t.pages.untitled)}</option>}
              </select>
            </label>
            <label className="flex items-center gap-1">
              {s.depth}
              <select
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
                className="min-h-9 rounded-md border border-border bg-background px-1 text-sm text-foreground"
              >
                {DEPTHS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label()}
                  </option>
                ))}
              </select>
            </label>
            <span className="ml-auto">{s.depthHint(effectiveScope === "page")}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={s.kindLabel}>
            {(["text", ...KINDS] as const).map((value) => {
              const on = value === "text" ? !activeKind && !mapsMode && !boardsMode : activeKind === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(value)}
                  className={`min-h-9 rounded-full border px-3 text-xs ${on ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
                >
                  {value === "text" ? s.kindText : `${KIND_ICONS[value]} ${s.kinds[value]}`}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={mapsMode}
              onClick={() => setKind("maps")}
              className={`min-h-9 rounded-full border px-3 text-xs ${mapsMode ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
            >
              🧠 {s.maps}
            </button>
            <button
              type="button"
              aria-pressed={boardsMode}
              onClick={() => setKind("boards")}
              className={`min-h-9 rounded-full border px-3 text-xs ${boardsMode ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"}`}
            >
              🎨 {s.boards}
            </button>
          </div>
          {said && <p className="mt-1 text-xs text-muted">{s.kindSaid(s.kinds[said.kind])}</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-2" aria-live="polite">
          {boardsMode ? (
            !boardHits ? (
              <p className="p-3 text-sm text-muted">{s.searching}</p>
            ) : boardHits.length === 0 ? (
              <p className="p-3 text-sm text-muted">{pending ? s.searching : s.nothing}</p>
            ) : (
              boardList(boardHits)
            )
          ) : mapsMode ? (
            !mapHits ? (
              <p className="p-3 text-sm text-muted">{s.searching}</p>
            ) : mapHits.length === 0 ? (
              <p className="p-3 text-sm text-muted">{pending ? s.searching : s.nothing}</p>
            ) : (
              mapList(mapHits)
            )
          ) : activeKind ? (
            !blockHits ? (
              <p className="p-3 text-sm text-muted">{s.searching}</p>
            ) : blockHits.length === 0 ? (
              <p className="p-3 text-sm text-muted">{pending ? s.searching : s.nothing}</p>
            ) : (
              <ul aria-label={s.results} data-block-results>
                {blockHits.map((hit) => (
                  <li key={`${hit.id}#${hit.block_id}`}>
                    <Link
                      href={`${pagePath(workspace.shortId, hit.id)}#${hit.block_id}`}
                      onClick={onNavigate}
                      className="flex gap-3 rounded-md px-3 py-2 hover:bg-surface"
                    >
                      <span className="shrink-0 text-lg">{KIND_ICONS[activeKind]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.block_text || s.kinds[activeKind]}</span>
                        <span className="block truncate text-xs text-muted">
                          {hit.icon ?? "📄"} {hit.title || t.pages.untitled}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : !shown ? (
            <p className="p-3 text-sm text-muted">{s.hint}</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-sm text-muted">{pending ? s.searching : s.nothing}</p>
          ) : (
            <ul aria-label={s.results}>
              {shown.map((hit) => {
                const path = ancestorsOf(pages, hit.id).slice(0, -1);
                return (
                  <li key={hit.id}>
                    <Link
                      href={pagePath(workspace.shortId, hit.id)}
                      onClick={onNavigate}
                      className="flex gap-3 rounded-md px-3 py-2 hover:bg-surface"
                    >
                      <span className="shrink-0 text-lg">{hit.icon ?? "📄"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.title || t.pages.untitled}</span>
                        {path.length > 0 && (
                          <span className="block truncate text-xs text-muted">
                            {path.map((p) => p.title || t.pages.untitled).join(" / ")}
                          </span>
                        )}
                        {hit.snippet && <Snippet text={hit.snippet} />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {shown && mapHits && mapHits.length > 0 && (
            <div className="mt-2 border-t border-border pt-2">
              <p className="px-3 pb-1 text-xs font-medium text-muted">{s.maps}</p>
              {mapList(mapHits)}
            </div>
          )}
          {shown && boardHits && boardHits.length > 0 && (
            <div className="mt-2 border-t border-border pt-2">
              <p className="px-3 pb-1 text-xs font-medium text-muted">{s.boards}</p>
              {boardList(boardHits)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const KINDS: BlockKind[] = ["heading", "image", "video", "table", "code", "quote", "checklist", "callout", "diagram", "link"];
const KIND_ICONS: Record<BlockKind, string> = {
  heading: "🔠",
  image: "🖼️",
  video: "🎬",
  table: "▦",
  code: "⌨️",
  quote: "❝",
  checklist: "☑️",
  callout: "💬",
  diagram: "🧭",
  link: "🔗",
};

// Words that ask for a kind instead of text: "картинки", "заголовок бюджет" (a heading containing "бюджет").
export function detectKind(query: string): { kind: BlockKind; rest: string } | null {
  const [first = "", ...rest] = query.trim().toLowerCase().split(/\s+/);
  for (const kind of KINDS) {
    if ((s.kindWords[kind] as readonly string[]).some((word) => first === word || (word.length > 4 && first.startsWith(word)))) {
      return { kind, rest: rest.join(" ") };
    }
  }
  return null;
}
