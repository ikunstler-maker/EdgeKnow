"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { readMap, type MapData } from "@/lib/nodes";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import type { Person } from "@/lib/tasks";
import { saveNodeMap, setNodeMapGroupRole, setNodeMapMemberRole, setNodeMapWorkspaceRole, trashNodeMap } from "@/app/node-actions";
import { useRouter } from "next/navigation";
import { workspacePath } from "@/lib/paths";

const MindMapCanvas = dynamic(() => import("./mind-map-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">…</p> });

const n = t.nodes;

// One map: its title, the save status, access, and the canvas. Changes are saved
// about a second after the last one; a save that finds a newer version stops and says so.
export function NodeMapScreen({
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
  const [map, setMap] = useState<MapData>(() => readMap(initialData, n.centralTopic));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: MapData | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const queued = () => pending.current;
  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (queued()) {
      const next = queued()!;
      pending.current = null;
      setStatus("saving");
      const result = await saveNodeMap(shortId, id, next.title, next.data, version.current).catch(() => null);
      if (result?.ok) {
        version.current = result.version;
        setStatus("saved");
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      // Kept for the next try, with anything typed meanwhile.
      const later = queued();
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: MapData }) => {
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

  const changeMap = (next: MapData) => {
    setMap(next);
    schedule({ data: next });
  };

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
            placeholder={n.titlePlaceholder}
            aria-label={n.titlePlaceholder}
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title || n.untitled}</h1>
        )}
        <span className="text-xs text-muted" role="status" data-save-status={status}>
          {status === "saving" ? n.saving : status === "saved" ? n.saved : ""}
        </span>
        {access && (
          <ObjectAccessButton
            label={n.access}
            title={n.accessTitle}
            intro={n.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (role) => setNodeMapWorkspaceRole(shortId, id, role),
              setMemberRole: (member, role) => setNodeMapMemberRole(shortId, id, member, role),
              setGroupRole: (group, role) => setNodeMapGroupRole(shortId, id, group, role),
            }}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              await trashNodeMap(shortId, id);
              router.push(workspacePath(shortId, "/nodes"));
            }}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface md:min-h-9"
          >
            🗑️ {n.toBin}
          </button>
        )}
      </div>
      {!canEdit && <p className="mt-1 text-sm text-muted">{n.readOnly}</p>}
      {status === "conflict" && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          {n.conflict}
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-border bg-background px-3">
            {n.reload}
          </button>
        </p>
      )}
      <MindMapCanvas map={map} editable={canEdit && status !== "conflict"} onChange={changeMap} onLocalChange={setMap} />
    </div>
  );
}
