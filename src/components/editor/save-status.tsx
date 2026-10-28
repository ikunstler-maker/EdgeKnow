"use client";

import { useSyncExternalStore } from "react";
import { dateLocale, t } from "@/i18n";
import type { Conflict, SaveStatus } from "./use-autosave";

const noop = () => () => {};

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const s = t.editor.save;
  const text: Record<SaveStatus, string> = {
    saved: s.saved,
    dirty: s.unsaved,
    saving: s.saving,
    offline: s.offline,
    error: s.error,
    too_large: s.tooLarge,
    conflict: s.unsaved,
  };
  const warn = status === "offline" || status === "error" || status === "too_large";
  return (
    <span role="status" aria-live="polite" className={`text-xs ${warn ? "text-danger" : "text-muted"}`}>
      {status === "saved" ? "✓ " : ""}
      {text[status]}
    </span>
  );
}

export function ConflictBanner({
  conflict,
  onKeepMine,
  onTakeTheirs,
}: {
  conflict: Conflict;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const c = t.editor.conflict;
  // The time in the reader's own zone, so it renders only in the browser.
  const time = useSyncExternalStore(
    noop,
    () =>
      conflict.updatedAt
        ? new Intl.DateTimeFormat(dateLocale(), { timeStyle: "short" }).format(new Date(conflict.updatedAt))
        : "—",
    () => "",
  );
  return (
    <div role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
      <p>{c.message(conflict.updatedBy ?? c.someone, time)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTakeTheirs}
          title={c.takeTheirsHint}
          className="min-h-11 rounded-lg border border-border bg-background px-3 hover:bg-surface"
        >
          {c.takeTheirs}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(c.confirmKeepMine)) onKeepMine();
          }}
          className="min-h-11 rounded-lg bg-danger px-3 font-medium text-white hover:opacity-90"
        >
          {c.keepMine}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{c.takeTheirsHint}</p>
    </div>
  );
}
