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
import { StudioNotices, StudioShell } from "@/components/ui/studio-shell";

const MindMapCanvas = dynamic(() => import("./mind-map-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">…</p> });
const DiagramCanvas = dynamic(() => import("@/components/editor/diagram-canvas"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">…</p> });

const n = t.nodes;

// One map: its title, the save status, access, and the canvas. Changes are saved
// about a second after the last one; a save that finds a newer version stops and says so.
export function NodeMapScreen({
  kind = "mindmap",
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  canEdit,
  access,
  members,
}: {
  kind?: "mindmap" | "flow";
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
  // A diagram is kept as the canvas's own text and saved as an object.
  const [diagram] = useState(() => JSON.stringify(initialData ?? {}));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: unknown } | null>(null);
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
    (patch: { title?: string; data?: unknown }) => {
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

  const editable = canEdit && status !== "conflict";
  // The diagram takes a height in pixels: all the room under the bar and its own toolbar.
  const flowBox = useRef<HTMLDivElement>(null);
  const [flowHeight, setFlowHeight] = useState(640);
  useEffect(() => {
    const box = flowBox.current;
    if (!box) return;
    const measure = () => setFlowHeight(Math.max(320, box.clientHeight - 56));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <StudioShell
      service="nodes"
      backHref={workspacePath(shortId, "/nodes")}
      backLabel={n.back}
      title={title}
      onTitle={
        canEdit
          ? (value) => {
              setTitle(value);
              schedule({ title: value });
            }
          : undefined
      }
      titleLabel={n.titlePlaceholder}
      untitled={n.untitled}
      status={status}
      savingLabel={n.saving}
      savedLabel={n.saved}
      center={undefined}
      files={[]}
      access={
        access && (
          <ObjectAccessButton
            label={n.access}
            title={n.accessTitle}
            intro={n.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (r) => setNodeMapWorkspaceRole(shortId, id, r),
              setMemberRole: (member, r) => setNodeMapMemberRole(shortId, id, member, r),
              setGroupRole: (group, r) => setNodeMapGroupRole(shortId, id, group, r),
            }}
          />
        )
      }
      primary={undefined}
      more={[
        ...(canEdit
          ? [
              {
                label: n.toBin,
                icon: "trash" as const,
                danger: true,
                onSelect: async () => {
                  await trashNodeMap(shortId, id);
                  router.push(workspacePath(shortId, "/nodes"));
                },
                attrs: { "data-to-bin": "" },
              },
            ]
          : []),
      ]}
      notices={<StudioNotices readOnly={canEdit ? null : n.readOnly} conflict={status === "conflict" ? n.conflict : null} reloadLabel={n.reload} error={null} />}
    >
      {kind === "flow" ? (
        <div ref={flowBox} className="min-h-0 flex-1 overflow-hidden" data-flow>
          <DiagramCanvas
            large
            data={diagram}
            height={flowHeight}
            editable={editable}
            onChange={(next) => schedule({ data: JSON.parse(next) })}
            onHeightChange={() => {}}
          />
        </div>
      ) : (
        <MindMapCanvas shortId={shortId} map={map} editable={editable} onChange={changeMap} onLocalChange={setMap} />
      )}
    </StudioShell>
  );
}
