"use client";

import { useSyncExternalStore } from "react";
import type { Heading } from "./table-of-contents";

// Where the contents go on pages that also have comments, remembered per browser:
// "right" — a "Зміст | Коментарі" switch in the right column; "bottom" — under the
// text; "left" — in the sidebar instead of the page tree.
export type TocPlacement = "right" | "bottom" | "left";

const KEY = "edgeknow.toc-placement";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function readPlacement(): TocPlacement {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "bottom" || value === "left" ? value : "right";
  } catch {
    return "right";
  }
}

export function setTocPlacement(value: TocPlacement) {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Not remembered; applies to this visit only.
  }
  placement = value;
  notify();
}

let placement: TocPlacement | null = null;

export function useTocPlacement(): TocPlacement {
  return useSyncExternalStore(
    subscribe,
    () => (placement ??= readPlacement()),
    () => "right",
  );
}

// The contents the page asks the sidebar to show (left placement), and whether the
// sidebar currently shows them or the page tree.
type SidebarToc = { headings: Heading[]; showTree: boolean } | null;
let sidebarToc: SidebarToc = null;

export function publishSidebarToc(headings: Heading[] | null) {
  if (headings === null) sidebarToc = null;
  else sidebarToc = { headings, showTree: sidebarToc?.showTree ?? false };
  notify();
}

export function setSidebarShowsTree(showTree: boolean) {
  if (!sidebarToc) return;
  sidebarToc = { ...sidebarToc, showTree };
  notify();
}

export function useSidebarToc(): SidebarToc {
  return useSyncExternalStore(
    subscribe,
    () => sidebarToc,
    () => null,
  );
}
