"use client";

import { useEffect, useSyncExternalStore } from "react";
import { taskChips, type ChipTask } from "@/app/task-wiki-actions";

// Live task chips on a page: every chip asks for its task; asks within a moment
// are read together, and all of them again every 30 seconds while the page is
// shown (and when it comes back into view) — so a status changed elsewhere shows
// up without editing the page.

type Entry = ChipTask | null; // null: no access (or no such task)
const tasks = new Map<string, Entry>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let shortId = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let version = 0;

const notify = () => {
  version += 1;
  for (const listener of listeners) listener();
};

async function load(ids: string[]) {
  if (!ids.length || !shortId) return;
  const found = await taskChips(shortId, ids).catch(() => null);
  if (!found) return;
  const byId = new Map(found.map((task) => [task.id, task]));
  for (const id of ids) tasks.set(id, byId.get(id) ?? null);
  notify();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load([...wanted].filter((id) => !tasks.has(id)));
  }, 30);
}

export function refreshTaskChips() {
  void load([...wanted]);
}

function startPolling() {
  if (poll || typeof window === "undefined") return;
  poll = setInterval(() => document.visibilityState === "visible" && refreshTaskChips(), 30_000);
  const onVisible = () => document.visibilityState === "visible" && refreshTaskChips();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

export function useTaskChip(workspace: string | undefined, id: string): Entry | undefined {
  useEffect(() => {
    if (!workspace || !id) return;
    if (shortId !== workspace) {
      shortId = workspace;
      tasks.clear();
    }
    wanted.add(id);
    startPolling();
    schedule();
  }, [workspace, id]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
  return tasks.get(id);
}

// After creating a task on the page: show it at once.
export function rememberTask(task: ChipTask) {
  tasks.set(task.id, task);
  wanted.add(task.id);
  notify();
}
