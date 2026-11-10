"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { pageVersion, pageVersions, restorePageVersion, type PageVersionItem } from "@/app/page-actions";
import { compareVersions, PagePreview } from "@/components/editor/page-preview";
import { ProBadge } from "@/components/ui/pro-badge";
import { usePages } from "./pages-provider";

const h = t.history;
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const until = (from: string, to: string) => {
  const end = new Date(to);
  return new Date(from).toDateString() === end.toDateString() && to !== from
    ? `${when(from)}–${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : when(from);
};

// "Історія": the page's versions (owner and editors only), one shown with what differs
// from the current text, and "Restore this version".
export function PageHistoryButton({ pageId, canRestore }: { pageId: string; canRestore: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass} data-page-history>
        {h.button}
      </button>
      {open && <HistoryDialog pageId={pageId} canRestore={canRestore} onClose={() => setOpen(false)} />}
    </>
  );
}

type Shown = { id: string; title: string; content: unknown; current: unknown };

function HistoryDialog({ pageId, canRestore, onClose }: { pageId: string; canRestore: boolean; onClose: () => void }) {
  const { workspace } = usePages();
  const [list, setList] = useState<PageVersionItem[] | null | undefined>(undefined);
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void pageVersions(workspace.shortId, pageId).then((result) => alive && setList(result));
    return () => {
      alive = false;
    };
  }, [workspace.shortId, pageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const pick = (id: string) =>
    startTransition(async () => {
      setStatus(null);
      const version = await pageVersion(workspace.shortId, id);
      setShown(version ? { id, title: version.title, content: version.content, current: version.current } : null);
    });

  const restore = (id: string) => {
    if (!window.confirm(h.confirm)) return;
    startTransition(async () => {
      const result = await restorePageVersion(id);
      if (result.ok) {
        // The editor holds the old text: open the page afresh with the restored one.
        window.location.reload();
      } else {
        setStatus(h.errors[result.error] ?? t.common.unknownError);
      }
    });
  };

  const diff = shown ? compareVersions(shown.content, shown.current) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={h.title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
        data-history-dialog
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">{h.title}</h2>
          <button type="button" onClick={onClose} aria-label={h.close} className="min-h-11 min-w-11">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="max-h-[35vh] shrink-0 overflow-y-auto border-b border-border p-2 md:max-h-none md:w-72 md:border-b-0 md:border-r">
            {list === undefined && <p className="p-2 text-sm text-muted">{h.loading}</p>}
            {(list === null || list?.length === 0) && <p className="p-2 text-sm text-muted">{h.empty}</p>}
            <ul className="space-y-1">
              {(list ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => pick(item.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface ${shown?.id === item.id ? "bg-surface" : ""}`}
                    data-version-item={item.reason}
                  >
                    <span className="block font-medium">{until(item.createdAt, item.lastAt)}</span>
                    <span className="block text-xs text-muted">
                      {h.reasons[item.reason]} · {item.author ?? h.someone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-3 text-xs text-muted">{h.keep}</p>
            <p className="flex items-center gap-2 px-3 py-1 text-xs text-muted">
              {h.longer} <ProBadge />
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!shown && <p className="text-sm text-muted">{pending ? h.loading : h.choose}</p>}
            {shown && diff && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {diff.marks.size === 0 && diff.missing === 0 ? (
                    <span>{h.same}</span>
                  ) : (
                    <>
                      <span>{h.compared}</span>
                      <span className="rounded border-l-4 border-amber-500 bg-amber-500/10 px-2">{h.changed}</span>
                      <span className="rounded border-l-4 border-emerald-500 bg-emerald-500/10 px-2">{h.added}</span>
                      {diff.missing > 0 && <span>{h.missing(diff.missing)}</span>}
                    </>
                  )}
                </div>
                <h3 className="mb-2 text-2xl font-bold">{shown.title || t.pages.untitled}</h3>
                <PagePreview content={shown.content} history={{ marks: diff.marks, boxLabel: h.box }} />
              </>
            )}
          </div>
        </div>
        {shown && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
            {status && (
              <p role="status" className="flex-1 text-sm">
                {status}
              </p>
            )}
            {!canRestore && <p className="flex-1 text-sm text-muted">{h.cantRestore}</p>}
            <button
              type="button"
              disabled={pending || !canRestore || list?.[0]?.id === shown.id}
              onClick={() => restore(shown.id)}
              className="ml-auto min-h-11 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60 md:min-h-9"
              data-restore-version
            >
              {pending ? h.restoring : h.restore}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
