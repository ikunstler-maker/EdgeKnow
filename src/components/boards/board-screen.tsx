"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readBoard, type BoardData } from "@/lib/boards";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveBoard, setBoardGroupRole, setBoardMemberRole, setBoardWorkspaceRole, trashBoard } from "@/app/board-actions";

const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">{t.boards.loading}</p> });

const b = t.boards;

// One board: its name, the save status, access and the canvas. Changes are saved
// about a second after the last one; a save that finds a newer version stops
// and says so (working together live comes with step Д2).
export function BoardScreen({
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  canEdit,
  access,
  members,
}: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: unknown;
  initialVersion: number;
  canEdit: boolean;
  access: ObjectAccess | null;
  members: Person[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [initial] = useState(() => readBoard(initialData));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: BoardData | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      setStatus("saving");
      const result = await saveBoard(shortId, id, next.title, next.data, version.current).catch(() => null);
      if (result?.ok) {
        version.current = result.version;
        setStatus("saved");
        setError(null);
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      // Kept for the next try, with anything drawn meanwhile.
      const later = pending.current as { title: string | null; data: BoardData | null } | null;
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      setError(result && !result.ok ? (b.errors[result.error] ?? t.common.unknownError) : t.common.unknownError);
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: BoardData }) => {
      if (!canEdit || status === "conflict") return;
      pending.current = { title: patch.title ?? pending.current?.title ?? null, data: patch.data ?? pending.current?.data ?? null };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 900);
    },
    [canEdit, status, flush],
  );

  // Unsaved changes are sent before leaving the page.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  return (
    <div className="mt-2 flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              schedule({ title: e.target.value });
            }}
            placeholder={b.titlePlaceholder}
            aria-label={b.titlePlaceholder}
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title || b.untitled}</h1>
        )}
        <span className="text-xs text-muted" role="status" data-save-status={status}>
          {status === "saving" ? b.saving : status === "saved" ? b.saved : ""}
        </span>
        {access && (
          <ObjectAccessButton
            label={b.access}
            title={b.accessTitle}
            intro={b.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (role) => setBoardWorkspaceRole(shortId, id, role),
              setMemberRole: (member, role) => setBoardMemberRole(shortId, id, member, role),
              setGroupRole: (group, role) => setBoardGroupRole(shortId, id, group, role),
            }}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              await trashBoard(shortId, id);
              router.push(workspacePath(shortId, "/boards"));
            }}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            🗑️ {b.toBin}
          </button>
        )}
      </div>
      {canEdit ? <p className="mt-1 hidden text-xs text-muted md:block">{b.hints}</p> : <p className="mt-1 text-sm text-muted">{b.readOnly}</p>}
      {status === "conflict" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {b.conflict}
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-border bg-background px-3">
            {b.reload}
          </button>
        </p>
      )}
      {error && status === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 h-[calc(100dvh-12rem)] min-h-[420px] overflow-hidden rounded-lg border border-border" data-board>
        <BoardCanvas initial={initial} editable={canEdit && status !== "conflict"} onChange={(data) => schedule({ data })} />
      </div>
    </div>
  );
}
