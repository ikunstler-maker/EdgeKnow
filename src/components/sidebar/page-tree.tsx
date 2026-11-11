"use client";

import { createContext, use, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { t } from "@/i18n";
import {
  canEdit,
  childrenOf,
  rootsOf,
  sectionOf,
  siblingsOf,
  subtreeIds,
  type PageNode,
  type SidebarSection,
} from "@/lib/pages";
import { pagePath } from "@/lib/paths";
import { usePages } from "@/components/pages/pages-provider";
import { MoveDialog } from "@/components/pages/move-dialog";
import { MenuItem, Popover } from "@/components/ui/popover";
import { setExpanded, useExpanded } from "./expanded-store";
import { Icon } from "@/components/ui/icon";

type Zone = "before" | "inside" | "after";
type DropTarget = { id: string; zone: Zone };
type VisibleItem = { page: PageNode; depth: number; hasChildren: boolean };

const rowAction = "h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-border";

const SECTIONS: SidebarSection[] = ["workspace", "mine", "shared"];

function flattenVisible(pages: PageNode[], roots: PageNode[], expanded: Set<string>): VisibleItem[] {
  const out: VisibleItem[] = [];
  const walk = (nodes: PageNode[], depth: number) => {
    for (const page of nodes) {
      const children = childrenOf(pages, page.id);
      out.push({ page, depth, hasChildren: children.length > 0 });
      if (expanded.has(page.id)) walk(children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function pointerY(event: DragMoveEvent): number | null {
  const start = event.activatorEvent;
  const y =
    "touches" in start
      ? (start as TouchEvent).touches[0]?.clientY
      : (start as MouseEvent).clientY;
  return typeof y === "number" ? y + event.delta.y : null;
}

// A role may take "create pages" away: then no "add subpage" in the tree.
const CanCreateContext = createContext(true);

export function PageTree({
  userId,
  currentId,
  onNavigate,
  canCreate = true,
}: {
  userId: string;
  currentId: string | null;
  onNavigate?: () => void;
  canCreate?: boolean;
}) {
  const { pages, move } = usePages();
  const expanded = useExpanded();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const suppressClick = useRef(false);

  // Mouse: drag after moving 5px. Touch: hold ~0.25s first, so normal swipes still scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const roots = rootsOf(pages);
  const sections = SECTIONS.map((section) => ({
    section,
    items: flattenVisible(
      pages,
      roots.filter((p) => sectionOf(p, userId) === section),
      expanded,
    ),
  })).filter((s) => s.section === "mine" || s.items.length > 0);
  const blocked = activeId ? subtreeIds(pages, activeId) : new Set<string>();
  const activePage = activeId ? pages.find((p) => p.id === activeId) : undefined;

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDrop(null);
  };

  const onDragMove = (event: DragMoveEvent) => {
    const over = event.over;
    const y = pointerY(event);
    const overPage = over ? pages.find((p) => p.id === over.id) : undefined;
    if (!over || !overPage || y === null || blocked.has(overPage.id)) {
      if (drop) setDrop(null);
      return;
    }
    const ratio = (y - over.rect.top) / over.rect.height;
    let zone: Zone = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "inside";
    // Next to a page means into its parent: that one must be editable too.
    const parent = overPage.parentId ? pages.find((p) => p.id === overPage.parentId) : undefined;
    const besideAllowed = !parent || canEdit(parent.role);
    if (zone === "inside" && !canEdit(overPage.role)) zone = ratio < 0.5 ? "before" : "after";
    if (zone !== "inside" && !besideAllowed) {
      if (drop) setDrop(null);
      return;
    }
    if (drop?.id !== over.id || drop.zone !== zone) setDrop({ id: String(over.id), zone });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const target = drop;
    setActiveId(null);
    setDrop(null);
    // The browser fires a click right after a mouse drag ends; ignore that one.
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (!target || blocked.has(target.id)) return;

    const overPage = pages.find((p) => p.id === target.id);
    if (!overPage) return;

    if (target.zone === "inside") {
      const children = childrenOf(pages, overPage.id).filter((p) => p.id !== id);
      move(id, overPage.id, children.length);
      setExpanded(overPage.id, true);
      return;
    }

    const siblings = siblingsOf(pages, overPage).filter((p) => p.id !== id);
    const index = siblings.findIndex((p) => p.id === overPage.id);
    move(id, overPage.parentId, target.zone === "before" ? index : index + 1);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setDrop(null);
  };

  return (
    <CanCreateContext value={canCreate}>
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {sections.map(({ section, items }) => (
        <section key={section} aria-label={t.sidebar.sections[section]} className="mb-2">
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
            {t.sidebar.sections[section]}
          </p>
          {items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">{t.sidebar.empty}</p>
          ) : (
            <ul role="tree" aria-label={t.sidebar.sections[section]} title={t.sidebar.dragHint}>
              {items.map((item) => (
                <TreeRow
                  key={item.page.id}
                  item={item}
                  expanded={expanded.has(item.page.id)}
                  current={item.page.id === currentId}
                  dragging={item.page.id === activeId}
                  dropBlocked={blocked.has(item.page.id)}
                  dropZone={drop?.id === item.page.id ? drop.zone : null}
                  onNavigate={(event) => {
                    if (suppressClick.current) event.preventDefault();
                    else onNavigate?.();
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
      <DragOverlay dropAnimation={null}>
        {activePage && (
          <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm shadow-lg">
            {activePage.icon ? <span>{activePage.icon}</span> : <Icon name="file-text" className="text-muted" />}
            <span className="truncate">{activePage.title || t.pages.untitled}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
    </CanCreateContext>
  );
}

function TreeRow({
  item,
  expanded,
  current,
  dragging,
  dropBlocked,
  dropZone,
  onNavigate,
}: {
  item: VisibleItem;
  expanded: boolean;
  current: boolean;
  dragging: boolean;
  dropBlocked: boolean;
  dropZone: Zone | null;
  onNavigate: (event: React.MouseEvent) => void;
}) {
  const { page, depth, hasChildren } = item;
  const { workspace, pages, creating, create, rename, move, trash } = usePages();
  const canCreate = use(CanCreateContext);
  const editable = canEdit(page.role);
  const owner = page.role === "owner";
  // Moving needs edit rights on the page itself.
  const drag = useDraggable({ id: page.id, disabled: !editable });
  const dropArea = useDroppable({ id: page.id, disabled: dropBlocked });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);

  const title = page.title || t.pages.untitled;
  const indicator =
    dropZone === "before"
      ? "shadow-[inset_0_2px_0_var(--accent)]"
      : dropZone === "after"
        ? "shadow-[inset_0_-2px_0_var(--accent)]"
        : dropZone === "inside"
          ? "bg-accent/15"
          : "";

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={current}
    >
      <div
        ref={(el) => {
          drag.setNodeRef(el);
          dropArea.setNodeRef(el);
        }}
        {...drag.listeners}
        // Long-press is the touch drag gesture; keep the browser's link menu out of the way.
        onContextMenu={(event) => {
          if ((event.nativeEvent as PointerEvent).pointerType !== "mouse") event.preventDefault();
        }}
        style={{ paddingLeft: 4 + depth * 16 }}
        className={`group flex min-h-11 select-none items-center gap-1 rounded-md pr-1 [-webkit-touch-callout:none] md:min-h-9 ${
          current ? "bg-surface font-medium" : "hover:bg-surface"
        } ${dragging ? "opacity-40" : ""} ${indicator}`}
      >
        <button
          type="button"
          onClick={() => setExpanded(page.id, !expanded)}
          aria-label={expanded ? t.sidebar.collapse : t.sidebar.expand}
          className={`flex h-9 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-border ${
            hasChildren ? "" : "invisible"
          }`}
        >
          <Icon name="chevron-right" size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {renaming ? (
          <input
            autoFocus
            defaultValue={page.title}
            maxLength={200}
            aria-label={t.pages.menu.rename}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(false);
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value !== page.title) rename(page.id, value);
              setRenaming(false);
            }}
            className="min-h-9 min-w-0 flex-1 rounded border border-accent bg-background px-2 text-base md:text-sm"
          />
        ) : (
          <Link prefetch={false}
            href={pagePath(workspace.shortId, page.id)}
            onClick={onNavigate}
            draggable={false}
            data-angler-here={current ? "" : undefined}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm"
          >
            {page.icon ? <span className={`shrink-0${page.draft ? " opacity-60" : ""}`}>{page.icon}</span> : <Icon name="file-text" className={`text-muted${page.draft ? " opacity-60" : ""}`} />}
            <span className={`truncate${page.draft ? " text-muted" : ""}`}>{title}</span>
            {page.draft && (
              <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted" title={t.drafts.treeHint} data-tree-draft>
                {t.drafts.badge}
              </span>
            )}
            {page.needsAck && (
              <span className="shrink-0 text-xs text-accent" title={t.acks.badge} aria-label={t.acks.badge} data-tree-ack>
                <Icon name="check-circle" size={14} />
              </span>
            )}
            {creating.has(page.id) && (
              <span className="ml-auto shrink-0 animate-pulse text-xs text-muted" data-page-creating>
                {t.pages.creating}
              </span>
            )}
          </Link>
        )}

        {/* On desktop they appear on hover and take no room otherwise, so the title reaches
            the edge of the panel. On touch screens only "⋯" stays (its menu can add a subpage). */}
        {editable && (
          <>
            {canCreate && <button
              type="button"
              onClick={() => {
                create(page.id);
                setExpanded(page.id, true);
              }}
              aria-label={t.sidebar.addSubpage}
              title={t.sidebar.addSubpage}
              className={`${rowAction} hidden [@media(hover:hover)]:group-hover:flex [@media(hover:hover)]:group-focus-within:flex`}
            >
              +
            </button>}
            <button
              type="button"
              onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
              aria-label={t.sidebar.moreActions}
              title={t.sidebar.moreActions}
              className={`${rowAction} ${menuAnchor ? "flex" : "flex [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover:flex [@media(hover:hover)]:group-focus-within:flex"}`}
            >
              ⋯
            </button>
          </>
        )}
      </div>

      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              setRenaming(true);
            }}
          >
            {t.pages.menu.rename}
          </MenuItem>
          {canCreate && (
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              create(page.id);
              setExpanded(page.id, true);
            }}
          >
            {t.pages.menu.addSubpage}
          </MenuItem>
          )}
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              setMoving(true);
            }}
          >
            {t.pages.menu.moveTo}
          </MenuItem>
          {owner && (
            <MenuItem
              danger
              onSelect={() => {
                setMenuAnchor(null);
                trash(page.id);
              }}
            >
              {t.pages.menu.delete}
            </MenuItem>
          )}
        </Popover>
      )}

      {moving && (
        <MoveDialog
          pages={pages}
          pageId={page.id}
          onClose={() => setMoving(false)}
          onMove={(parentId) => {
            const count = (parentId === null ? rootsOf(pages) : childrenOf(pages, parentId)).filter(
              (p) => p.id !== page.id,
            ).length;
            move(page.id, parentId, count);
            if (parentId) setExpanded(parentId, true);
          }}
        />
      )}
    </li>
  );
}
