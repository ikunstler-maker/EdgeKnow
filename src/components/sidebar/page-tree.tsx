"use client";

import { useRef, useState } from "react";
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
import { childrenOf, rootsOf, siblingsOf, subtreeIds, type PageNode } from "@/lib/pages";
import { pagePath } from "@/lib/paths";
import { usePages } from "@/components/pages/pages-provider";
import { MoveDialog } from "@/components/pages/move-dialog";
import { MenuItem, Popover } from "@/components/ui/popover";
import { setExpanded, useExpanded } from "./expanded-store";

type Zone = "before" | "inside" | "after";
type DropTarget = { id: string; zone: Zone };
type VisibleItem = { page: PageNode; depth: number; hasChildren: boolean };

function flattenVisible(pages: PageNode[], expanded: Set<string>): VisibleItem[] {
  const out: VisibleItem[] = [];
  const walk = (nodes: PageNode[], depth: number) => {
    for (const page of nodes) {
      const children = childrenOf(pages, page.id);
      out.push({ page, depth, hasChildren: children.length > 0 });
      if (expanded.has(page.id)) walk(children, depth + 1);
    }
  };
  walk(rootsOf(pages), 0);
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

export function PageTree({
  currentId,
  onNavigate,
}: {
  currentId: string | null;
  onNavigate?: () => void;
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

  const items = flattenVisible(pages, expanded);
  const blocked = activeId ? subtreeIds(pages, activeId) : new Set<string>();
  const activePage = activeId ? pages.find((p) => p.id === activeId) : undefined;

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDrop(null);
  };

  const onDragMove = (event: DragMoveEvent) => {
    const over = event.over;
    const y = pointerY(event);
    if (!over || y === null || blocked.has(String(over.id))) {
      if (drop) setDrop(null);
      return;
    }
    const ratio = (y - over.rect.top) / over.rect.height;
    const zone: Zone = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "inside";
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

  if (items.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted">{t.sidebar.empty}</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <ul role="tree" aria-label={t.sidebar.pagesHeading} title={t.sidebar.dragHint}>
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
      <DragOverlay dropAnimation={null}>
        {activePage && (
          <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm shadow-lg">
            <span>{activePage.icon ?? "📄"}</span>
            <span className="truncate">{activePage.title || t.pages.untitled}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
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
  const { workspace, pages, create, rename, move, trash } = usePages();
  const drag = useDraggable({ id: page.id });
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
          <span className={`inline-block text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>
            ▶
          </span>
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
          <Link
            href={pagePath(workspace.shortId, page.id)}
            onClick={onNavigate}
            draggable={false}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm"
          >
            <span className="shrink-0">{page.icon ?? "📄"}</span>
            <span className="truncate">{title}</span>
          </Link>
        )}

        {/* Always visible on touch screens; on desktop they appear on hover. */}
        <button
          type="button"
          onClick={() => {
            create(page.id);
            setExpanded(page.id, true);
          }}
          aria-label={t.sidebar.addSubpage}
          title={t.sidebar.addSubpage}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-border [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus:opacity-100"
        >
          +
        </button>
        <button
          type="button"
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
          aria-label={t.sidebar.moreActions}
          title={t.sidebar.moreActions}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-border [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus:opacity-100"
        >
          ⋯
        </button>
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
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              create(page.id);
              setExpanded(page.id, true);
            }}
          >
            {t.pages.menu.addSubpage}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              setMoving(true);
            }}
          >
            {t.pages.menu.moveTo}
          </MenuItem>
          <MenuItem
            danger
            onSelect={() => {
              setMenuAnchor(null);
              trash(page.id);
            }}
          >
            {t.pages.menu.delete}
          </MenuItem>
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
