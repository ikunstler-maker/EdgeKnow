"use client";

import { useId, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import type { SlideNode } from "@/lib/slides";
import { childrenOf, isContainer } from "@/lib/design";
import { Icon, type IconName } from "@/components/ui/icon";
import { TOOL_ICON } from "@/components/slides/tool-icons";

const g = t.design;
const l = t.slides.layers;
const icon = (n: SlideNode): IconName => (n.type === "FRAME" && n.autoLayout ? "columns" : (TOOL_ICON[n.type] ?? "square"));
const small = "flex h-9 w-7 shrink-0 items-center justify-center rounded text-xs hover:bg-white/10";

// The layer tree of a page: nesting shown by indent, folding, search; dragging a layer
// onto a frame or group puts it inside, onto another layer puts it after that one.
export function DesignLayers({
  nodes,
  selected,
  onSelect,
  onNode,
  onDrop,
}: {
  nodes: SlideNode[];
  selected: string[];
  onSelect: (ids: string[], add: boolean) => void;
  onNode: (id: string, change: (n: SlideNode) => SlideNode) => void;
  onDrop: (id: string, onto: string, inside: boolean) => void;
}) {
  const dndId = useId();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over ? String(event.over.id) : null;
    if (!over || over === event.active.id) return;
    const target = nodes.find((n) => n.id === over);
    if (target) onDrop(String(event.active.id), over, isContainer(target));
  };
  const q = query.trim().toLowerCase();
  const rows: { node: SlideNode; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => {
    // Top of the list = drawn last (on top).
    for (const n of [...childrenOf(nodes, pid)].reverse()) {
      if (!q || n.name.toLowerCase().includes(q)) rows.push({ node: n, depth: q ? 0 : depth });
      if (!closed.has(n.id) || q) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    <div className="space-y-2" data-design-layers>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={g.search} aria-label={g.search} className="min-h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm" />
      {!rows.length && <p className="text-xs opacity-60">{l.none}</p>}
      <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
        <ul aria-label={g.layers}>
          {rows.map(({ node, depth }) => (
            <Row
              key={node.id}
              node={node}
              depth={depth}
              active={selected.includes(node.id)}
              hasKids={nodes.some((n) => n.parentId === node.id)}
              open={!closed.has(node.id)}
              onToggle={() => {
                const next = new Set(closed);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                setClosed(next);
              }}
              onSelect={onSelect}
              onNode={onNode}
            />
          ))}
        </ul>
      </DndContext>
    </div>
  );
}

function Row({
  node,
  depth,
  active,
  hasKids,
  open,
  onToggle,
  onSelect,
  onNode,
}: {
  node: SlideNode;
  depth: number;
  active: boolean;
  hasKids: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (ids: string[], add: boolean) => void;
  onNode: (id: string, change: (n: SlideNode) => SlideNode) => void;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });
  const { setNodeRef, transform, isDragging, listeners, attributes } = useDraggable({ id: node.id });
  const [renaming, setRenaming] = useState(false);
  return (
    <li
      ref={(el) => {
        dropRef(el);
        setNodeRef(el);
      }}
      style={{ paddingLeft: depth * 12, ...(transform ? { transform: `translate3d(0, ${transform.y}px, 0)` } : {}) }}
      className={`flex items-center gap-0.5 rounded ${active ? "bg-sky-500/25" : isOver ? (isContainer(node) ? "ring-1 ring-sky-400" : "border-b border-sky-400") : "hover:bg-white/5"} ${isDragging ? "relative z-10 opacity-80" : ""}`}
      data-layer={node.name}
      data-layer-depth={depth}
    >
      <button type="button" className={small} onClick={onToggle} aria-label={open ? g.collapse(node.name) : g.expand(node.name)} disabled={!hasKids} style={{ visibility: hasKids ? "visible" : "hidden" }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
      </button>
      <span {...listeners} {...attributes} className="w-5 shrink-0 cursor-grab touch-none text-center text-xs opacity-70" aria-label={l.drag(node.name)}>
        <Icon name={icon(node)} size={14} />
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={node.name}
          onBlur={(e) => {
            setRenaming(false);
            const name = e.target.value.trim().slice(0, 80);
            if (name && name !== node.name) onNode(node.id, (n) => ({ ...n, name }));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label={l.rename(node.name)}
          className="min-h-8 min-w-0 flex-1 rounded bg-black/30 px-1 text-sm"
        />
      ) : (
        <button type="button" onClick={(e) => onSelect([node.id], e.shiftKey)} onDoubleClick={() => setRenaming(true)} className={`min-h-9 min-w-0 flex-1 truncate text-left text-sm ${node.hidden ? "line-through opacity-50" : ""}`} data-layer-pick>
          {node.name}
        </button>
      )}
      <button type="button" className={small} aria-pressed={!!node.hidden} aria-label={node.hidden ? l.show(node.name) : l.hide(node.name)} onClick={() => onNode(node.id, (n) => ({ ...n, hidden: !n.hidden || undefined }))} data-layer-hide>
        <Icon name={node.hidden ? "eye-off" : "eye"} size={14} />
      </button>
      <button type="button" className={small} aria-pressed={!!node.locked} aria-label={node.locked ? l.unlock(node.name) : l.lock(node.name)} onClick={() => onNode(node.id, (n) => ({ ...n, locked: !n.locked || undefined }))} data-layer-lock>
        <Icon name={node.locked ? "lock" : "unlock"} size={14} />
      </button>
    </li>
  );
}
