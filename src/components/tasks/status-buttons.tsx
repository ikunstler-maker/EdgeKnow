"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { ColumnMoves, TaskStatus } from "@/lib/tasks";
import { Icon } from "@/components/ui/icon";

// May a task go from one column to another, by the columns' own rules (the database
// decides in the end; this only greys out what it would refuse).
export function moveAllowed(moves: ColumnMoves, from: string, to: string) {
  return from === to || (moves[from]?.take !== false && moves[to]?.put !== false);
}

// The status as a row of buttons (desktop only; a phone has the list): one per column,
// each with the column's short name and colour. Columns of other boards follow under
// their board's name. A long row has no scrollbar: it scrolls by the wheel and by
// dragging, and a fading edge with an arrow shows there is more.
export function StatusButtons({
  groups,
  current,
  moves,
  disabled,
  onPick,
}: {
  groups: { label: string | null; statuses: TaskStatus[] }[];
  current: string;
  moves: ColumnMoves;
  disabled: boolean;
  onPick: (statusId: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const next = { left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 };
    setMore((before) => (before.left === next.left && before.right === next.right ? before : next));
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // Not passive: the wheel scrolls the row and not the page while there is where to scroll.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    el.querySelector<HTMLElement>("[aria-checked='true']")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [current, measure]);

  const step = (by: number) => row.current?.scrollBy({ left: by * Math.max(160, row.current.clientWidth * 0.6), behavior: "smooth" });
  const edge = "absolute inset-y-0 z-10 flex w-12 items-center from-background via-background/80 to-transparent";
  return (
    <div className="relative hidden min-w-0 md:block" data-status-row>
      <div
        ref={row}
        role="radiogroup"
        aria-label={t.tasks.fields.status}
        className="flex min-w-0 cursor-grab items-center gap-1 overflow-x-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button === 0) drag.current = { x: e.clientX, left: row.current?.scrollLeft ?? 0, moved: false };
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
        {groups.map((group, index) => (
          <span key={group.label ?? "main"} className="contents">
            {group.label !== null && (
              <span className={`shrink-0 whitespace-nowrap text-xs text-muted ${index > 0 ? "ml-2 border-l border-border pl-3" : ""}`} data-status-board={group.label}>
                {group.label}
              </span>
            )}
            {group.statuses.map((s) => {
              const on = s.id === current;
              const allowed = moveAllowed(moves, current, s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled || (!on && !allowed)}
                  title={!allowed ? `${s.name} — ${t.tasks.board.moveForbidden}` : s.name}
                  onClick={() => !on && onPick(s.id)}
                  style={on && s.color ? { borderColor: s.color, background: `${s.color}26` } : undefined}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-sm ${
                    on ? "border-accent bg-accent/10 font-semibold" : "border-border text-muted hover:border-border-strong hover:text-foreground"
                  } disabled:cursor-not-allowed ${on ? "" : "disabled:opacity-50"}`}
                  data-status-button={s.name}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.color ? "" : "bg-muted"}`} style={s.color ? { background: s.color } : undefined} />
                  {s.short_name || s.name}
                </button>
              );
            })}
          </span>
        ))}
      </div>
      {more.left && (
        <div className={`${edge} left-0 justify-start bg-gradient-to-r`} data-status-more="left">
          <button type="button" tabIndex={-1} aria-label={t.tasks.card.statusesBefore} onClick={() => step(-1)} className="flex h-8 w-7 items-center justify-center rounded-md text-muted hover:text-foreground">
            <Icon name="chevron-left" />
          </button>
        </div>
      )}
      {more.right && (
        <div className={`${edge} right-0 justify-end bg-gradient-to-l`} data-status-more="right">
          <button type="button" tabIndex={-1} aria-label={t.tasks.card.statusesAfter} onClick={() => step(1)} className="flex h-8 w-7 items-center justify-center rounded-md text-muted hover:text-foreground">
            <Icon name="chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
