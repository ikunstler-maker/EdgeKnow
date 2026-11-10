// Page tree types and pure helpers, shared by server and client code.

export type PageRole = "owner" | "editor" | "commenter" | "viewer";
export type GrantRole = Exclude<PageRole, "owner">;

export type PageNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: number;
  ownerId: string;
  role: PageRole;
  // Whole-workspace access, own or inherited.
  workspaceRole: GrantRole | null;
  // Asks readers to confirm it (shown with a quiet seal in the tree).
  needsAck?: boolean;
  // Not published yet (the page or a page above it): only its people see it.
  draft?: boolean;
};

// Pages that are drafts or sit under one (by parent): kept out of the workspace backup.
export function draftPageIds(rows: { id: string; parent_id: string | null; published_at: string | null }[]): Set<string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const memo = new Map<string, boolean>();
  const isDraft = (id: string, depth = 0): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const row = byId.get(id);
    const result = Boolean(row && (row.published_at === null || (row.parent_id && depth < 100 && isDraft(row.parent_id, depth + 1))));
    memo.set(id, result);
    return result;
  };
  return new Set(rows.filter((row) => isDraft(row.id)).map((row) => row.id));
}

// Columns for the tree; my_role and shared_with_workspace are computed in the database.
export const PAGE_TREE_COLUMNS = "id, parent_id, title, icon, position, owner_id, my_role, shared_with_workspace, ack_label";

export type PageRow = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: number;
  owner_id: string;
  my_role: PageRole;
  shared_with_workspace: GrantRole | null;
  ack_label: string | null;
  // From my_page_tree only (the older way of reading the tree has no such column).
  draft?: boolean;
};

export function toPageNode(row: PageRow): PageNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    ownerId: row.owner_id,
    role: row.my_role,
    workspaceRole: row.shared_with_workspace,
    needsAck: Boolean(row.ack_label),
    draft: Boolean(row.draft),
  };
}

export function canEdit(role: PageRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export type SidebarSection = "workspace" | "mine" | "shared";

// Notion-like sidebar: pages open to the whole workspace, my own pages, and pages
// someone shared with me whose parent I can't see.
export function sectionOf(page: PageNode, userId: string): SidebarSection {
  if (page.workspaceRole) return "workspace";
  return page.ownerId === userId ? "mine" : "shared";
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
