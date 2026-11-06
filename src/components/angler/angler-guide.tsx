"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import { AnglerFish } from "./angler-fish";
import { useAppearance } from "./appearance";

// The fish swims to the left of wherever the person is: the current page in the
// tree (marked data-angler-here) or the current link at the bottom (trash,
// profile…). When that place is scrolled out of sight it waits at the edge,
// pointing the way. Five quick clicks on it open the "Depth" game.

export const ANGLER_GAME_EVENT = "ek-angler-game";
const CLICKS = 5;
const CLICK_WINDOW_MS = 2000;

type Spot = { x: number; y: number; edge: "up" | "down" | null };

export function AnglerGuide({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { appearance } = useAppearance();
  const pathname = usePathname();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [swimming, setSwimming] = useState(false);
  const clicks = useRef<number[]>([]);
  const last = useRef<Spot | null>(null);

  useEffect(() => {
    const nav = containerRef.current;
    if (!appearance.showMascot || !nav) return;
    let frame = 0;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = nav.querySelector<HTMLElement>("[data-angler-here]");
        if (!target) {
          last.current = null;
          setSpot(null);
          return;
        }
        const navBox = nav.getBoundingClientRect();
        const box = target.getBoundingClientRect();
        let y = box.top + box.height / 2;
        let edge: Spot["edge"] = null;
        const scroller = target.closest<HTMLElement>("[data-angler-scroll]");
        if (scroller) {
          const area = scroller.getBoundingClientRect();
          if (y < area.top + 10) [y, edge] = [area.top + 14, "up"];
          else if (y > area.bottom - 10) [y, edge] = [area.bottom - 14, "down"];
        }
        // Just left of the row (30 px: the fish's width), never on top of it.
        const next = { x: box.left - navBox.left - 30, y: y - navBox.top, edge };
        const before = last.current;
        if (before && Math.abs(before.y - next.y) < 0.5 && Math.abs(before.x - next.x) < 0.5 && before.edge === next.edge) return;
        // A real move (not the first placement) is a swim: the tail goes faster for a moment.
        if (before && Math.abs(before.y - next.y) > 4) {
          setSwimming(true);
          clearTimeout(rest);
          rest = setTimeout(() => setSwimming(false), 800);
        }
        last.current = next;
        setSpot(next);
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(nav);
    const changes = new MutationObserver(place);
    changes.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-angler-here"] });
    nav.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(rest);
      resize.disconnect();
      changes.disconnect();
      nav.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [appearance.showMascot, pathname, containerRef]);

  if (!appearance.showMascot || !spot) return null;
  const label = spot.edge === "up" ? t.angler.above : spot.edge === "down" ? t.angler.below : t.angler.here;
  return (
    <button
      type="button"
      data-angler
      aria-label={label}
      title={label}
      onClick={() => {
        const now = Date.now();
        clicks.current = [...clicks.current.filter((at) => now - at < CLICK_WINDOW_MS), now];
        if (clicks.current.length >= CLICKS) {
          clicks.current = [];
          window.dispatchEvent(new Event(ANGLER_GAME_EVENT));
        }
      }}
      className="ek-angler-guide absolute left-0 top-0 z-10 h-[26px] w-[30px] p-0"
      style={{
        transform: `translate(${spot.x - 1}px, ${spot.y - 13}px) rotate(${spot.edge === "up" ? -35 : spot.edge === "down" ? 35 : 0}deg)`,
      }}
    >
      <AnglerFish swimming={swimming} className="h-full w-full" />
    </button>
  );
}
