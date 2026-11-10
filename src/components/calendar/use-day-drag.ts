"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Picking days by dragging across cells (the month grid, the week's "all day" row):
// press on a cell, drag over others — along a row or down the weeks — release. The cells
// carry their day in a data attribute, so the cell under the pointer is found wherever
// it is. A press without a move is a pick of that one day. Touch keeps its taps and
// scrolling: dragging is for a mouse or a pen.
export type DayRange = { first: string; last: string };

export function useDayDrag(attribute: string, onPick: (range: DayRange) => void) {
  const [range, setRange] = useState<{ anchor: string; current: string } | null>(null);
  const live = useRef<{ anchor: string; current: string } | null>(null);
  // A drag ends with a click event of its own; the cell's click handler asks this to skip it.
  const justDragged = useRef(false);

  const dayAt = useCallback(
    (x: number, y: number) => {
      for (const el of document.elementsFromPoint(x, y)) {
        const day = (el as HTMLElement).dataset?.[attribute];
        if (day) return day;
      }
      return null;
    },
    [attribute],
  );

  const onPointerDown = (day: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    // Chips, links and buttons inside a cell keep their own clicks.
    if ((event.target as HTMLElement).closest("a, button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    live.current = { anchor: day, current: day };
    setRange(live.current);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!live.current) return;
    const day = dayAt(event.clientX, event.clientY);
    if (day && day !== live.current.current) {
      live.current = { ...live.current, current: day };
      setRange(live.current);
    }
  };
  const finish = (pick: boolean) => {
    const done = live.current;
    live.current = null;
    setRange(null);
    if (!done || !pick) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    const [first, last] = done.anchor <= done.current ? [done.anchor, done.current] : [done.current, done.anchor];
    onPick({ first, last });
  };

  const selected = range ? (range.anchor <= range.current ? { first: range.anchor, last: range.current } : { first: range.current, last: range.anchor }) : null;
  return {
    selected,
    isSelected: (day: string) => !!selected && day >= selected.first && day <= selected.last,
    // True right after a drag: the click that follows it is not a pick of its own.
    consumeClick: () => justDragged.current,
    handlers: (day: string) => ({
      onPointerDown: onPointerDown(day),
      onPointerMove,
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
    }),
  };
}
