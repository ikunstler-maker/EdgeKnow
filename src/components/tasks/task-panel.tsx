"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/i18n";
import { IconButton, iconButtonClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// Which task the board is opening or closing right now, so the panel answers a tap at
// once and does not wait for the server: `opening` shows an empty panel until the task
// arrives; `closed` hides the panel of that task until the address catches up.
let state: { opening: string | null; closed: string | null } = { opening: null, closed: null };
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const empty = { opening: null, closed: null };

// The address that opens a task of this project in the panel, keeping the view and the filters.
export function useTaskPanelHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (number: number) => {
    const query = new URLSearchParams(params.toString());
    query.set("task", String(number));
    return `${pathname}?${query}`;
  };
}
// Call on the tap that opens a task (the link itself does the navigation).
export const openingTask = (number: number) => set({ opening: String(number), closed: null });

// A task over the board: a sheet on the right (the whole screen on a phone). The address
// carries `?task=N`, so the link can be shared and "Back" closes the panel. Closes with
// its ✕, a tap outside and Escape (unless something inside is being typed or is open).
export function TaskPanel({ number, pageBase, children }: { number: string | null; pageBase: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { opening, closed } = useSyncExternalStore(subscribe, () => state, () => empty);
  // The address caught up: the task has arrived, or the panel is closed for good.
  useEffect(() => {
    if (number && state.opening === number) set({ ...state, opening: null });
    if (number === null && state.closed) set({ ...state, closed: null });
  }, [number]);

  const shown = opening ?? (number && number !== closed ? number : null);
  const close = () => {
    set({ opening: null, closed: number });
    const query = new URLSearchParams(params.toString());
    query.delete("task");
    const rest = query.toString();
    router.push(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A menu or a dialog on top closes first; typing loses the focus, not the task.
      if (document.querySelector('[data-popover], [aria-modal="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return active.blur();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (!shown) return null;
  const ready = number === shown && number !== null;
  return (
    <div className="fixed inset-0 z-40" data-task-panel={shown}>
      <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" data-task-panel-backdrop />
      <section
        role="dialog"
        aria-label={t.tasks.card.panel(shown)}
        className="absolute inset-y-0 right-0 flex w-full max-w-[62rem] flex-col border-l border-border-strong bg-background shadow-2xl"
      >
        <header className="flex items-center justify-end gap-1 border-b border-border px-2 py-1">
          {ready && (
            <Link href={`${pageBase}/${shown}`} className={iconButtonClass("ghost")} aria-label={t.tasks.card.openPage} title={t.tasks.card.openPage} data-task-panel-page>
              <Icon name="maximize" size={18} />
            </Link>
          )}
          <IconButton icon="close" label={t.tasks.card.closePanel} onClick={close} data-task-panel-close />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-6">{ready ? children : <p className="py-12 text-center text-sm text-muted">{t.tasks.card.loading}</p>}</div>
      </section>
    </div>
  );
}
