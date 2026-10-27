"use client";

import { useMemo, useSyncExternalStore } from "react";

// Which tree branches are open, remembered per browser. Storage may be unavailable
// (private mode, blocked site data), so every access is guarded and falls back to
// "everything collapsed".
const KEY = "edgeknow.sidebar.expanded";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function write(ids: Set<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Not persisted; the tree still works for this visit.
  }
  listeners.forEach((listener) => listener());
}

function parse(raw: string): Set<string> {
  try {
    const value = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExpanded() {
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  return useMemo(() => parse(raw), [raw]);
}

export function setExpanded(id: string, open: boolean) {
  const ids = parse(read());
  if (open) ids.add(id);
  else ids.delete(id);
  write(ids);
}

export function expandAll(idsToOpen: string[]) {
  const ids = parse(read());
  const before = ids.size;
  idsToOpen.forEach((id) => ids.add(id));
  if (ids.size !== before) write(ids);
}
