"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { IconButton } from "./button";

// A modal window: a blurred dark backdrop, one raised panel. Closes on Escape, on a
// tap outside and with its ✕; a phone gets it as a sheet from the bottom.
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button");
    first?.focus();
    return () => before?.focus?.();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-4" onClick={onClose} data-dialog-backdrop>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-border-strong bg-overlay shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center gap-2 py-2 pl-5 pr-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h2>
          <IconButton icon="close" label={t.common.close} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
