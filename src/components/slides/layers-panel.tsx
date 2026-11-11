"use client";

import { useId } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import type { Slide, SlideNode } from "@/lib/slides";
import { Icon } from "@/components/ui/icon";
import { TOOL_ICON } from "@/components/slides/tool-icons";

const l = t.slides.layers;
const smallButton = "flex h-11 w-9 shrink-0 items-center justify-center rounded text-sm hover:bg-surface md:h-8 md:w-7";

// The layers of a slide, top first: pick, rename, drag to reorder, hide, lock.
export function LayersPanel({
  slide,
  selected,
  onSelect,
  onNode,
  onReorder,
}: {
  slide: Slide;
  selected: string[];
  onSelect: (ids: string[], add: boolean) => void;
  onNode: (id: string, change: (n: SlideNode) => SlideNode) => void;
  onReorder: (id: string, toIndex: number) => void;
}) {
  const dndId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const top = [...slide.nodes].reverse();
  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over ? String(event.over.id) : null;
    if (!over || over === event.active.id) return;
    onReorder(String(event.active.id), slide.nodes.findIndex((n) => n.id === over));
  };
  if (!top.length) return <p className="text-sm text-muted">{l.none}</p>;
  return (
    <DndContext id={dndId} sensors={sensors} onDragEnd={onDragEnd}>
      <ul className="space-y-0.5" aria-label={l.title} data-layers>
        {top.map((node) => (
          <LayerRow key={node.id} node={node} active={selected.includes(node.id)} onSelect={onSelect} onNode={onNode} />
        ))}
      </ul>
    </DndContext>
  );
}

function LayerRow({ node, active, onSelect, onNode }: { node: SlideNode; active: boolean; onSelect: (ids: string[], add: boolean) => void; onNode: (id: string, change: (n: SlideNode) => SlideNode) => void }) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });
  const { setNodeRef, transform, isDragging, listeners, attributes } = useDraggable({ id: node.id });
  const style = transform ? { transform: `translate3d(0, ${transform.y}px, 0)` } : undefined;
  return (
    <li
      ref={(el) => {
        dropRef(el);
        setNodeRef(el);
      }}
      style={style}
      className={`flex items-center gap-1 rounded-md px-1 ${active ? "bg-accent/15" : isOver ? "bg-surface" : ""} ${isDragging ? "relative z-10 shadow" : ""}`}
      data-layer={node.name}
    >
      <button type="button" {...listeners} {...attributes} className={`${smallButton} cursor-grab touch-none text-muted`} aria-label={l.drag(node.name)}>
        <Icon name="drag" />
      </button>
      <Icon name={node.groupId ? "group" : (TOOL_ICON[node.type] ?? "square")} size={14} className="mx-0.5 text-muted" />
      <input
        value={node.name}
        onChange={(e) => onNode(node.id, (n) => ({ ...n, name: e.target.value.slice(0, 80) }))}
        onFocus={(e) => onSelect([node.id], (e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey === true)}
        aria-label={l.rename(node.name)}
        className={`min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none md:min-h-8 ${node.hidden ? "text-muted line-through" : ""}`}
      />
      <button type="button" className={smallButton} aria-pressed={!!node.hidden} aria-label={node.hidden ? l.show(node.name) : l.hide(node.name)} title={node.hidden ? l.show(node.name) : l.hide(node.name)} onClick={() => onNode(node.id, (n) => ({ ...n, hidden: !n.hidden || undefined }))} data-layer-hide>
        <Icon name={node.hidden ? "eye-off" : "eye"} size={14} />
      </button>
      <button type="button" className={smallButton} aria-pressed={!!node.locked} aria-label={node.locked ? l.unlock(node.name) : l.lock(node.name)} title={node.locked ? l.unlock(node.name) : l.lock(node.name)} onClick={() => onNode(node.id, (n) => ({ ...n, locked: !n.locked || undefined }))} data-layer-lock>
        <Icon name={node.locked ? "lock" : "unlock"} size={14} />
      </button>
    </li>
  );
}
