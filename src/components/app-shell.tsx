"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import type { WorkspaceSummary } from "@/lib/workspace";
import { usePages } from "@/components/pages/pages-provider";
import { Sidebar } from "@/components/sidebar/sidebar";

// Desktop: the sidebar is always on the left. Phone: it lives in a drawer opened
// with ☰ or a swipe from the left edge of the screen.
export function AppShell({
  user,
  workspaces,
  children,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  children: ReactNode;
}) {
  const { workspace } = usePages();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      swipeStart.current = touch.clientX < 24 ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const start = swipeStart.current;
      const touch = event.touches[0];
      if (!start) return;
      const dx = touch.clientX - start.x;
      if (dx > 60 && Math.abs(touch.clientY - start.y) < 40) {
        setDrawerOpen(true);
        swipeStart.current = null;
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const close = () => setDrawerOpen(false);

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface/60 md:block">
        <Sidebar user={user} workspaces={workspaces} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
          <aside
            aria-label={t.sidebar.pagesHeading}
            className="absolute inset-y-0 left-0 w-[85%] max-w-xs border-r border-border bg-background shadow-xl"
          >
            <Sidebar user={user} workspaces={workspaces} onNavigate={close} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-1 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t.sidebar.openMenu}
            className="flex h-11 w-11 items-center justify-center rounded-md text-xl hover:bg-surface"
          >
            ☰
          </button>
          <span className="truncate font-semibold">{workspace.name}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
