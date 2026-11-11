"use client";

import { useEffect, useRef } from "react";
import { t } from "@/i18n";
import type { ColumnMoves, TaskStatus } from "@/lib/tasks";

// May a task go from one column to another, by the columns' own rules (the database
// decides in the end; this only greys out what it would refuse).
export function moveAllowed(moves: ColumnMoves, from: string, to: string) {
  return (
    from === to || (moves[from]?.take !== false && moves[to]?.put !== false)
  );
}

// The status as a row of buttons (desktop): one per column of the task's board, each with
// the column's short name and colour. A long row scrolls by the wheel and by dragging.
export function StatusButtons({
  statuses,
  current,
  moves,
  disabled,
  onPick,
}: {
  statuses: TaskStatus[];
  current: string;
  moves: ColumnMoves;
  disabled: boolean;
  onPick: (statusId: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // Not passive: the wheel scrolls the row and not the page while there is where to scroll.
    const onWheel = (e: WheelEvent) => {
      if (
        el.scrollWidth <= el.clientWidth ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY)
      )
        return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.querySelector<HTMLElement>("[aria-checked='true']")?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
    return () => el.removeEventListener("wheel", onWheel);
  }, [current]);

  return (
    <div
      ref={row}
      role="radiogroup"
      aria-label={t.tasks.fields.status}
      className="hidden min-w-0 flex-1 cursor-grab gap-1 overflow-x-auto [scrollbar-width:none] active:cursor-grabbing md:flex [&::-webkit-scrollbar]:hidden"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button === 0)
          drag.current = {
            x: e.clientX,
            left: row.current?.scrollLeft ?? 0,
            moved: false,
          };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !row.current) return;
        if (Math.abs(e.clientX - d.x) > 5) d.moved = true;
        if (d.moved) row.current.scrollLeft = d.left - (e.clientX - d.x);
      }}
      onPointerUp={() => setTimeout(() => (drag.current = null))}
      onPointerLeave={() => (drag.current = null)}
      // A drag of the row is not a press of the button under the pointer.
      onClickCapture={(e) => {
        if (drag.current?.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      data-status-buttons
    >
      {statuses.map((s) => {
        const on = s.id === current;
        const allowed = moveAllowed(moves, current, s.id);
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || (!on && !allowed)}
            title={
              !allowed ? `${s.name} — ${t.tasks.board.moveForbidden}` : s.name
            }
            onClick={() => !on && onPick(s.id)}
            style={
              on && s.color
                ? { borderColor: s.color, background: `${s.color}26` }
                : undefined
            }
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-sm ${
              on
                ? "border-accent bg-accent/10 font-semibold"
                : "border-border text-muted hover:border-border-strong hover:text-foreground"
            } disabled:cursor-not-allowed ${on ? "" : "disabled:opacity-50"}`}
            data-status-button={s.name}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${s.color ? "" : "bg-muted"}`}
              style={s.color ? { background: s.color } : undefined}
            />
            {s.short_name || s.name}
          </button>
        );
      })}
    </div>
  );
}
