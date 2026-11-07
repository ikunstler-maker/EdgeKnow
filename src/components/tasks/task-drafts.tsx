"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { createTask } from "@/app/task-actions";

// A task shown at once while the database makes it in the background. One that the
// database refused (or could not be reached for) stays, marked, with "retry", and is
// kept in this browser until it is saved or dismissed.
export type TaskDraft = { id: string; fields: Record<string, unknown>; state: "saving" | "failed" | "saved"; error?: string };

const storageKey = (projectId: string) => `edgeknow:task-drafts:${projectId}`;

function store(projectId: string, drafts: TaskDraft[]) {
  try {
    const failed = drafts.filter((d) => d.state === "failed");
    if (failed.length) localStorage.setItem(storageKey(projectId), JSON.stringify(failed));
    else localStorage.removeItem(storageKey(projectId));
  } catch {
    // Storage may be off (private mode): the notice still shows while the page is open.
  }
}

export function useTaskDrafts(projectId: string, serverTasks: unknown) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  // Saved ones go once the server's list (with the real task) has arrived.
  const [seen, setSeen] = useState(serverTasks);
  if (seen !== serverTasks) {
    setSeen(serverTasks);
    setDrafts(drafts.filter((d) => d.state !== "saved"));
  }

  // Unsaved ones from an earlier visit come back.
  useEffect(() => {
    let kept: TaskDraft[] = [];
    try {
      kept = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "[]");
    } catch {
      kept = [];
    }
    if (kept.length) queueMicrotask(() => setDrafts((list) => [...list, ...kept.filter((k) => !list.some((d) => d.id === k.id))]));
  }, [projectId]);

  const change = (id: string, patch: Partial<TaskDraft> | null) =>
    setDrafts((list) => {
      const next = patch ? list.map((d) => (d.id === id ? { ...d, ...patch } : d)) : list.filter((d) => d.id !== id);
      store(projectId, next);
      return next;
    });

  const send = (draft: TaskDraft) =>
    createTask(projectId, draft.fields).then(
      (result) => {
        if (result.ok) {
          change(draft.id, { state: "saved" });
          router.refresh();
        } else change(draft.id, { state: "failed", error: t.tasks.errors[result.error] ?? t.common.unknownError });
      },
      () => change(draft.id, { state: "failed", error: t.tasks.drafts.offline }),
    );

  return {
    drafts,
    create: (fields: Record<string, unknown>) => {
      const draft: TaskDraft = { id: crypto.randomUUID(), fields, state: "saving" };
      setDrafts((list) => [...list, draft]);
      void send(draft);
    },
    retry: (id: string) => {
      const draft = drafts.find((d) => d.id === id);
      if (!draft) return;
      change(id, { state: "saving", error: undefined });
      void send(draft);
    },
    dismiss: (id: string) => change(id, null),
  };
}

// The stand-in card of a task still being saved, or not saved.
export function DraftCard({ draft, onRetry, onDismiss }: { draft: TaskDraft; onRetry: () => void; onDismiss: () => void }) {
  const d = t.tasks.drafts;
  const failed = draft.state === "failed";
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${failed ? "border-danger/50 bg-danger/5" : "border-dashed border-border bg-background opacity-80"}`}
      data-task-draft={draft.state}
      role={failed ? "alert" : undefined}
    >
      <p className="break-words">{String(draft.fields.title ?? "")}</p>
      {failed ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex-1 text-danger">
            {d.notSaved}
            {draft.error ? ` ${draft.error}` : ""}
          </span>
          <button type="button" onClick={onRetry} className="min-h-11 rounded-md border border-border px-3 hover:bg-surface md:min-h-8">
            {d.retry}
          </button>
          <button type="button" onClick={onDismiss} className="min-h-11 rounded-md px-3 text-muted hover:bg-surface md:min-h-8">
            {d.dismiss}
          </button>
        </div>
      ) : (
        <p className="mt-1 animate-pulse text-xs text-muted">{d.saving}</p>
      )}
    </div>
  );
}
