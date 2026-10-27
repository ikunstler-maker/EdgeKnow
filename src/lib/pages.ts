// Page tree types and pure helpers, shared by server and client code.

export type PageNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: number;
};

export type PageRow = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
};

export function toPageNode(row: PageRow): PageNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
  };
}

export function childrenOf(pages: PageNode[], parentId: string | null): PageNode[] {
  return pages
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

// Roots are pages without a parent, plus pages whose parent the user can't see.
export function rootsOf(pages: PageNode[]): PageNode[] {
  const ids = new Set(pages.map((p) => p.id));
  return pages
    .filter((p) => p.parentId === null || !ids.has(p.parentId))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

export function siblingsOf(pages: PageNode[], page: PageNode): PageNode[] {
  return page.parentId === null ? rootsOf(pages) : childrenOf(pages, page.parentId);
}

// From the top-level page down to (and including) `id`.
export function ancestorsOf(pages: PageNode[], id: string): PageNode[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chain: PageNode[] = [];
  let current = byId.get(id);
  while (current && chain.length < 100) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function subtreeIds(pages: PageNode[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && result.has(p.parentId) && !result.has(p.id)) {
        result.add(p.id);
        grew = true;
      }
    }
  }
  return result;
}

// Mirrors public.place_page: puts `id` at `index` among `parentId`'s children.
export function movePageLocally(
  pages: PageNode[],
  id: string,
  parentId: string | null,
  index: number,
): PageNode[] {
  const moved = pages.find((p) => p.id === id);
  if (!moved) return pages;
  const siblings = (parentId === null ? rootsOf(pages) : childrenOf(pages, parentId)).filter(
    (p) => p.id !== id,
  );
  const clamped = Math.max(0, Math.min(index, siblings.length));
  const ordered = [...siblings.slice(0, clamped), moved, ...siblings.slice(clamped)];
  const positions = new Map(ordered.map((p, i) => [p.id, i]));
  return pages.map((p) =>
    positions.has(p.id)
      ? { ...p, position: positions.get(p.id)!, parentId: p.id === id ? parentId : p.parentId }
      : p,
  );
}
