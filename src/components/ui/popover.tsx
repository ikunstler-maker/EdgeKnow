"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A panel pinned next to the element that opened it. Rendered into <body> so the
// sidebar's scroll container can't clip it; closes on outside tap or Escape.
export function Popover({
  anchor,
  onClose,
  children,
  width = 224,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  const openUp = rect.bottom > window.innerHeight * 0.6;
  // As tall as the room on its side of the anchor allows, never past the screen edge.
  const room = (openUp ? rect.top : window.innerHeight - rect.bottom) - 4 - margin;
  const maxHeight = Math.max(160, room);
  const style = openUp
    ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + 4 }
    : { left, width, maxHeight, top: rect.bottom + 4 };

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="fixed z-50 overflow-y-auto rounded-xl border border-border-strong bg-overlay p-1 shadow-xl"
      data-popover
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onSelect,
  danger,
  children,
}: {
  onSelect: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-hover md:min-h-8 ${
        danger ? "text-danger" : ""
      }`}
    >
      {children}
    </button>
  );
}
