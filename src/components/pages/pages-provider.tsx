"use client";

import { createContext, use, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { movePageLocally, subtreeIds, type PageNode } from "@/lib/pages";
import {
  createPage,
  movePage,
  renamePage,
  setPageIcon,
  trashPage,
} from "@/app/(app)/page-actions";

type OptimisticOp =
  | { type: "rename"; id: string; title: string }
  | { type: "icon"; id: string; icon: string | null }
  | { type: "move"; id: string; parentId: string | null; index: number }
  | { type: "remove"; id: string };

function reducer(pages: PageNode[], op: OptimisticOp): PageNode[] {
  switch (op.type) {
    case "rename":
      return pages.map((p) => (p.id === op.id ? { ...p, title: op.title } : p));
    case "icon":
      return pages.map((p) => (p.id === op.id ? { ...p, icon: op.icon } : p));
    case "move":
      return movePageLocally(pages, op.id, op.parentId, op.index);
    case "remove": {
      // Hide the page and everything below it, like the trash does on the server.
      const removed = subtreeIds(pages, op.id);
      return pages.filter((p) => !removed.has(p.id));
    }
  }
}

type PagesContextValue = {
  pages: PageNode[];
  pending: boolean;
  create: (parentId: string | null) => void;
  rename: (id: string, title: string) => void;
  setIcon: (id: string, icon: string | null) => void;
  move: (id: string, parentId: string | null, index: number) => void;
  trash: (id: string) => void;
};

const PagesContext = createContext<PagesContextValue | null>(null);

export function usePages() {
  const value = use(PagesContext);
  if (!value) throw new Error("usePages must be used inside PagesProvider");
  return value;
}

export function errorMessage(result: ActionResult) {
  if (result.ok) return null;
  return t.pages.errors[result.error] ?? t.common.unknownError;
}

export function PagesProvider({ pages, children }: { pages: PageNode[]; children: ReactNode }) {
  const router = useRouter();
  const [optimisticPages, applyOptimistic] = useOptimistic(pages, reducer);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Applies the change on screen right away; the server's answer replaces it
  // (or rolls it back on failure) when the refreshed tree arrives.
  const run = (op: OptimisticOp | null, action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      if (op) applyOptimistic(op);
      const result = await action();
      setError(errorMessage(result));
    });

  const value: PagesContextValue = {
    pages: optimisticPages,
    pending,
    create: (parentId) =>
      startTransition(async () => {
        const result = await createPage(parentId);
        setError(errorMessage(result));
        if (result.ok) router.push(`/p/${result.id}`);
      }),
    rename: (id, title) => run({ type: "rename", id, title }, () => renamePage(id, title)),
    setIcon: (id, icon) => run({ type: "icon", id, icon }, () => setPageIcon(id, icon)),
    move: (id, parentId, index) =>
      run({ type: "move", id, parentId, index }, () => movePage(id, parentId, index)),
    trash: (id) => run({ type: "remove", id }, () => trashPage(id)),
  };

  return (
    <PagesContext value={value}>
      {children}
      {error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t.common.close}
            className="min-h-11 min-w-11"
          >
            ✕
          </button>
        </div>
      )}
    </PagesContext>
  );
}
