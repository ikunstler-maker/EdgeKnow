"use client";

import { createContext, use, useMemo, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/action-result";
import { movePageLocally, subtreeIds, type PageNode } from "@/lib/pages";
import { pagePath } from "@/lib/paths";
import {
  createPage,
  movePage,
  renamePage,
  setPageIcon,
  trashPage,
} from "@/app/page-actions";

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

export type WorkspaceInfo = {
  id: string;
  shortId: string;
  name: string;
  role: "owner" | "admin" | "member" | "guest";
};

type PagesContextValue = {
  workspace: WorkspaceInfo;
  pages: PageNode[];
  // The workspace's guests this person sees, marked «Гість» wherever people appear.
  guests: ReadonlySet<string>;
  pending: boolean;
  // Pages made in this browser that the server hasn't confirmed yet (shown as "creating").
  creating: ReadonlySet<string>;
  create: (parentId: string | null) => void;
  rename: (id: string, title: string) => void;
  setIcon: (id: string, icon: string | null) => void;
  move: (id: string, parentId: string | null, index: number) => void;
  trash: (id: string) => void;
};

const PagesContext = createContext<PagesContextValue | null>(null);

// Outside a workspace (e.g. a test harness) there is no page list.
export function useOptionalPages() {
  return use(PagesContext);
}

export function usePages() {
  const value = use(PagesContext);
  if (!value) throw new Error("usePages must be used inside PagesProvider");
  return value;
}

export function errorMessage(result: ActionResult) {
  if (result.ok) return null;
  return t.pages.errors[result.error] ?? t.common.unknownError;
}

export function PagesProvider({
  workspace,
  pages,
  guests = [],
  children,
}: {
  workspace: WorkspaceInfo;
  pages: PageNode[];
  guests?: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [optimisticPages, applyOptimistic] = useOptimistic(pages, reducer);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // New pages shown at once, until the server's tree has them.
  const [added, setAdded] = useState<PageNode[]>([]);
  const [creating, setCreating] = useState<ReadonlySet<string>>(new Set());
  const known = useMemo(() => new Set(pages.map((p) => p.id)), [pages]);
  const shownAdded = added.filter((p) => !known.has(p.id));

  // Applies the change on screen right away; the server's answer replaces it
  // (or rolls it back on failure) when the refreshed tree arrives.
  const run = (op: OptimisticOp | null, action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      if (op) applyOptimistic(op);
      const result = await action();
      setError(errorMessage(result));
    });

  const guestSet = useMemo(() => new Set(guests), [guests]);
  const value: PagesContextValue = {
    workspace,
    pages: shownAdded.length ? [...optimisticPages, ...shownAdded] : optimisticPages,
    guests: guestSet,
    pending,
    creating,
    create: (parentId) => {
      // The page gets its id here, shows in the tree and opens at once; the database
      // makes it in the meantime (the page waits for it), and the tree is refreshed after.
      const id = crypto.randomUUID();
      const siblings = optimisticPages.filter((p) => p.parentId === parentId);
      const parent = parentId ? optimisticPages.find((p) => p.id === parentId) : null;
      const node: PageNode = {
        id,
        parentId,
        title: "",
        icon: null,
        position: Math.max(0, ...siblings.map((p) => p.position)) + 1,
        ownerId: "",
        role: "owner",
        workspaceRole: parent?.workspaceRole ?? null,
      };
      setAdded((list) => [...list, node]);
      setCreating((set) => new Set(set).add(id));
      setError(null);
      // Where to return if the database refuses (not history.back: the new page may not be open yet).
      const from = window.location.pathname + window.location.search;
      router.push(`${pagePath(workspace.shortId, id)}?new=1`);
      createPage(workspace.id, parentId, id).then(
        (result) => {
          setCreating((set) => {
            const next = new Set(set);
            next.delete(id);
            return next;
          });
          if (result.ok) {
            router.refresh();
            return;
          }
          setAdded((list) => list.filter((p) => p.id !== id));
          setError(errorMessage(result));
          router.replace(from);
        },
        () => {
          setCreating((set) => {
            const next = new Set(set);
            next.delete(id);
            return next;
          });
          setAdded((list) => list.filter((p) => p.id !== id));
          setError(t.pages.errors.offline ?? t.common.unknownError);
          router.replace(from);
        },
      );
    },
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
