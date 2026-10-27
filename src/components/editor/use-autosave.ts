"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "too_large" | "conflict";

export type Conflict = { version: number; updatedAt: string | null; updatedBy: string | null };

type SaveResponse =
  | { ok: true; version: number }
  | { ok: false; error: string; version?: number; updated_at?: string; updated_by?: string };

const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;

// Saves the document a moment after the last change, one request at a time.
// Each save carries the version it was based on; the server answers "conflict"
// when someone else saved in between, and autosave stops until the user decides.
export function useAutosave({
  pageId,
  initialVersion,
  getContent,
}: {
  pageId: string;
  initialVersion: number;
  getContent: () => unknown[];
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const version = useRef(initialVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  // Set when edits happen while a save is running; that save is followed by another.
  const changedDuringSave = useRef(false);
  const stopped = useRef(false);
  const statusRef = useRef<SaveStatus>("saved");

  const update = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  // Timers call the latest save through a ref (save schedules its own retries).
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), delay);
  }, []);

  const save = useCallback(
    async (force = false) => {
      if (timer.current) clearTimeout(timer.current);
      if (inFlight.current) {
        changedDuringSave.current = true;
        return;
      }
      if (stopped.current && !force) return;

      inFlight.current = true;
      changedDuringSave.current = false;
      update("saving");
      let result: SaveResponse;
      try {
        const response = await fetch(`/api/pages/${pageId}/content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: getContent(), baseVersion: version.current, force }),
        });
        result = (await response.json()) as SaveResponse;
      } catch {
        inFlight.current = false;
        update("offline");
        schedule(RETRY_DELAY_MS);
        return;
      }
      inFlight.current = false;

      if (result.ok) {
        version.current = result.version;
        stopped.current = false;
        setConflict(null);
        if (changedDuringSave.current) {
          update("dirty");
          schedule(SAVE_DELAY_MS);
        } else {
          update("saved");
        }
        return;
      }

      if (result.error === "conflict") {
        stopped.current = true;
        setConflict({
          version: result.version ?? version.current,
          updatedAt: result.updated_at ?? null,
          updatedBy: result.updated_by ?? null,
        });
        update("conflict");
      } else if (result.error === "too_large") {
        update("too_large");
      } else {
        update("error");
        schedule(RETRY_DELAY_MS);
      }
    },
    [getContent, pageId, schedule, update],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const onChange = useCallback(() => {
    if (stopped.current) return;
    if (inFlight.current) changedDuringSave.current = true;
    update("dirty");
    schedule(SAVE_DELAY_MS);
  }, [schedule, update]);

  // Retry as soon as the connection comes back.
  useEffect(() => {
    const onOnline = () => {
      if (statusRef.current === "offline") void save();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [save]);

  // Warn before closing the tab with changes that aren't saved yet.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current === "saved") return;
      event.preventDefault();
      event.returnValue = t.editor.save.leaveWarning;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Leaving the page inside the app: send whatever is pending.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (statusRef.current === "dirty" && !stopped.current) {
        const body = JSON.stringify({ content: getContent(), baseVersion: version.current });
        // In-app navigation keeps the request alive anyway; keepalive (64 KB cap)
        // also covers a closing tab for ordinary-sized pages.
        void fetch(`/api/pages/${pageId}/content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: body.length < 60_000,
        }).catch(() => {});
      }
    },
    [getContent, pageId],
  );

  return {
    status,
    conflict,
    onChange,
    keepMine: () => save(true),
    // Accept the other version: nothing of ours is pending any more.
    discardLocal: () => {
      stopped.current = true;
      update("saved");
    },
  };
}
