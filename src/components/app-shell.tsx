"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { t } from "@/i18n";
import type { CurrentUser } from "@/lib/auth";
import type { WorkspaceSummary } from "@/lib/workspace";
import type { ProjectSummary } from "@/lib/tasks";
import { usePages } from "@/components/pages/pages-provider";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { Sidebar } from "@/components/sidebar/sidebar";
import { AppearanceProvider } from "@/components/angler/appearance";
import { AnglerGame } from "@/components/angler/angler-game";

// The desktop sidebar's width is set by dragging its right edge; each person's
// browser remembers it (a convenience, so it simply falls back to the default).
const WIDTH_KEY = "ek-sidebar-width";
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const clampWidth = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));

const widthListeners = new Set<() => void>();
function readSavedWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function useSidebarWidth() {
  const saved = useSyncExternalStore(
    (onChange) => {
      widthListeners.add(onChange);
      return () => widthListeners.delete(onChange);
    },
    readSavedWidth,
    () => DEFAULT_WIDTH,
  );
  // While dragging, the width follows the mouse; it is remembered when the button is let go.
  const [dragging, setDragging] = useState<number | null>(null);
  const save = (value: number) => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clampWidth(value)));
    } catch {}
    setDragging(null);
    widthListeners.forEach((notify) => notify());
  };
  return [dragging ?? saved, setDragging, save] as const;
}

// Desktop: the sidebar is always on the left. Phone: it lives in a drawer opened
// with ☰ or a swipe from the left edge of the screen.
export function AppShell({
  user,
  workspaces,
  projects,
  children,
}: {
  user: CurrentUser;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  children: ReactNode;
}) {
  const { workspace } = usePages();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [width, setWidth, saveWidth] = useSidebarWidth();
  const [resizing, setResizing] = useState(false);

  // Phone top bar: hides while scrolling down through a page, returns on scroll up.
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < 8) return;
      setHeaderHidden(y > lastY && y > 64);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    <AppearanceProvider initial={{ showMascot: user.showMascot, lure: user.lure }}>
    <div className="flex min-h-dvh flex-1">
      <aside
        className="sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-surface/60 md:block"
        style={{ width }}
        data-sidebar-width={width}
      >
        <Sidebar user={user} workspaces={workspaces} projects={projects} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t.sidebar.resize}
          title={t.sidebar.resize}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          data-sidebar-resize
          onPointerDown={(event) => {
            event.preventDefault();
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            const startX = event.clientX;
            const startWidth = width;
            let last = startWidth;
            setResizing(true);
            const move = (e: PointerEvent) => {
              last = clampWidth(startWidth + e.clientX - startX);
              setWidth(last);
            };
            const end = () => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", end);
              handle.removeEventListener("pointercancel", end);
              setResizing(false);
              saveWidth(last);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
          }}
          onDoubleClick={() => saveWidth(DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              saveWidth(width + (event.key === "ArrowRight" ? 16 : -16));
            }
          }}
          className={`absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent ${
            resizing ? "after:bg-accent" : ""
          }`}
        />
      </aside>
      {/* While dragging, text on the page must not get selected. */}
      {resizing && <div className="fixed inset-0 z-50 cursor-col-resize" aria-hidden="true" />}

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
          <aside
            aria-label={t.sidebar.pagesHeading}
            className="absolute inset-y-0 left-0 w-[85%] max-w-xs border-r border-border bg-background shadow-xl"
          >
            <Sidebar user={user} workspaces={workspaces} projects={projects} onNavigate={close} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-1 backdrop-blur transition-transform md:hidden ${
            headerHidden ? "-translate-y-full" : ""
          }`}
        >
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
      <FeedbackButton />
      <AnglerGame />
    </div>
    </AppearanceProvider>
  );
}
