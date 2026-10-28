"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { t } from "@/i18n";
import { ancestorsOf } from "@/lib/pages";
import { pagePath } from "@/lib/paths";
import { searchPages, type SearchHit } from "@/app/page-actions";
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
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);
  const currentPage = currentPageId ? pages.find((p) => p.id === currentPageId) : undefined;
  const effectiveScope = currentPage ? scope : "workspace";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Searches after a short pause in typing; only the latest answer is shown.
  useEffect(() => {
    const text = query.trim();
    const id = ++latest.current;
    const timer = setTimeout(() => {
      if (!text) return;
      startTransition(async () => {
        const result = await searchPages(
          workspace.id,
          text,
          effectiveScope === "page" ? (currentPageId ?? null) : null,
          depth === "all" ? null : Number(depth),
        );
        if (id === latest.current) setHits(result);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, effectiveScope, depth, workspace.id, currentPageId]);

  const shown = query.trim() ? hits : null;

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
        </div>
        <div className="flex-1 overflow-y-auto p-2" aria-live="polite">
          {!shown ? (
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
