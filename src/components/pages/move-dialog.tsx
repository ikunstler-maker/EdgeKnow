"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { canEdit, childrenOf, rootsOf, subtreeIds, type PageNode } from "@/lib/pages";
import { Icon } from "@/components/ui/icon";

type Option = { page: PageNode; depth: number };

function flatten(pages: PageNode[], nodes: PageNode[], depth: number, out: Option[]) {
  for (const page of nodes) {
    out.push({ page, depth });
    flatten(pages, childrenOf(pages, page.id), depth + 1, out);
  }
  return out;
}

// "Move to…" — the touch-friendly and keyboard-friendly alternative to dragging.
export function MoveDialog({
  pages,
  pageId,
  onMove,
  onClose,
}: {
  pages: PageNode[];
  pageId: string;
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const blocked = subtreeIds(pages, pageId);
  const current = pages.find((p) => p.id === pageId)?.parentId ?? null;
  // Only pages the user may edit can take a subpage.
  const options = flatten(pages, rootsOf(pages), 0, []).filter(
    (o) => !blocked.has(o.page.id) && canEdit(o.page.role),
  );

  const choose = (parentId: string | null) => {
    if (parentId !== current) onMove(parentId);
    onClose();
  };

  const rowClass = (active: boolean) =>
    `flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface ${
      active ? "font-semibold" : ""
    }`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.pages.move.title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl"
      >
        <h2 className="border-b border-border px-4 py-3 font-semibold">{t.pages.move.title}</h2>
        <div className="flex-1 overflow-y-auto p-2">
          <button type="button" onClick={() => choose(null)} className={rowClass(current === null)}>
            <Icon name="upload" className="mr-1 inline" />
            {t.pages.move.topLevel}
          </button>
          {options.map(({ page, depth }) => (
            <button
              key={page.id}
              type="button"
              onClick={() => choose(page.id)}
              className={rowClass(current === page.id)}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              {page.icon ? <span>{page.icon}</span> : <Icon name="file-text" className="text-muted" />}
              <span className="truncate">{page.title || t.pages.untitled}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-md border border-border text-sm hover:bg-surface"
          >
            {t.pages.move.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
