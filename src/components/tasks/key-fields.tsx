"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { t } from "@/i18n";
import type { TaskField } from "@/lib/tasks";
import { deleteTaskField, saveTaskField } from "@/app/task-actions";
import { Icon } from "@/components/ui/icon";

// The project's own fields in the task card. The project's owner (and the workspace's
// admins) put them in order by dragging and remove them: the set and the order are the project's, the same for everyone.
export function KeyFields({ projectId, fields, all, canOrder, render }: { projectId: string; fields: TaskField[]; all: TaskField[]; canOrder: boolean; render: (field: TaskField) => ReactNode }) {
  const router = useRouter();
  const [order, setOrder] = useState<{ from: TaskField[]; ids: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor));
  // The order just dragged is shown until the server's order arrives.
  const shown = order && order.from === fields ? order.ids.flatMap((id) => fields.find((f) => f.id === id) ?? []) : fields;

  const onDragEnd = (event: DragEndEvent) => {
    const from = shown.findIndex((x) => x.id === event.active.id);
    const to = shown.findIndex((x) => x.id === event.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    // Among all the project's fields (some are not shown for this task's type or are folded
    // away): the dragged one takes the place of the one it was dropped on.
    const sorted = [...all].sort((a, b) => a.position - b.position).filter((x) => x.id !== shown[from].id);
    const at = sorted.findIndex((x) => x.id === shown[to].id) + (from < to ? 1 : 0);
    const prev = sorted[at - 1];
    const next = sorted[at];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 0;
    const field = shown[from];
    const rest = shown.filter((_, i) => i !== from);
    const place = rest.findIndex((x) => x.id === shown[to].id) + (from < to ? 1 : 0);
    setOrder({ from: fields, ids: [...rest.slice(0, place), field, ...rest.slice(place)].map((x) => x.id) });
    startTransition(async () => {
      const result = await saveTaskField(projectId, field.id, { name: field.name, options: field.options, position });
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      if (!result.ok) setOrder(null);
      router.refresh();
    });
  };

  const remove = (field: TaskField) => {
    if (!confirm(t.tasks.card.removeFieldConfirm(field.name))) return;
    startTransition(async () => {
      const result = await deleteTaskField(field.id);
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      router.refresh();
    });
  };

  if (!canOrder) return <>{shown.map((field) => <div key={field.id}>{render(field)}</div>)}</>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {shown.map((field) => (
        <Slot key={field.id} field={field} movable={shown.length > 1} onRemove={() => remove(field)}>
          {render(field)}
        </Slot>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger @xl:col-span-2">
          {error}
        </p>
      )}
    </DndContext>
  );
}

function Slot({ field, movable, onRemove, children }: { field: TaskField; movable: boolean; onRemove: () => void; children: ReactNode }) {
  const drag = useDraggable({ id: field.id });
  const drop = useDroppable({ id: field.id });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 10, position: "relative" } : undefined}
      className={`group/field flex items-start gap-1 rounded-lg ${drop.isOver && !drag.isDragging ? "outline-2 outline-dashed outline-accent" : ""} ${drag.isDragging ? "bg-background opacity-90 shadow-lg" : ""}`}
      data-key-field={field.name}
    >
      <button
        type="button"
        {...drag.listeners}
        {...drag.attributes}
        aria-label={t.tasks.card.moveField(field.name)}
        title={t.tasks.card.moveField(field.name)}
        disabled={!movable}
        className="-ml-1 mt-5 flex h-11 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted opacity-70 hover:bg-hover hover:opacity-100 active:cursor-grabbing disabled:cursor-default disabled:opacity-30 md:h-8"
        data-key-field-handle
      >
        <Icon name="drag" size={14} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t.tasks.card.removeField(field.name)}
        title={t.tasks.card.removeField(field.name)}
        className="mt-5 flex h-11 w-8 shrink-0 items-center justify-center rounded text-muted opacity-70 hover:bg-hover hover:text-danger hover:opacity-100 md:h-8 md:w-6"
        data-key-field-remove
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}
