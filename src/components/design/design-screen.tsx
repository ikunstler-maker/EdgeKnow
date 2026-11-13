"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readDesign, type DesignDoc } from "@/lib/design";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveBoard, setBoardGroupRole, setBoardMemberRole, setBoardWorkspaceRole, trashBoard } from "@/app/board-actions";
import { DesignEditor } from "./design-editor";
import { StudioNotices, StudioShell } from "@/components/ui/studio-shell";
import { LivePresence, liveMenu } from "@/components/live/live-presence";
import { DESIGN_SPEC } from "@/lib/live/doc-sync";
import { useLiveDoc } from "@/lib/live/use-live-doc";

const s = t.slides;
const g = t.design;

// One design file: its name, the save status, access and the editor. Changes are
// saved about a second after the last one; a save that finds a newer version stops
// and asks to reload (as tables do).
export function DesignScreen({
  shortId,
  id,
  initialTitle,
  initialData,
  initialVersion,
  role,
  access,
  members,
}: {
  shortId: string;
  id: string;
  initialTitle: string;
  initialData: unknown;
  initialVersion: number;
  role: string;
  access: ObjectAccess | null;
  members: Person[];
}) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "editor";
  const [title, setTitle] = useState(initialTitle);
  const [initial] = useState(() => readDesign(initialData, g.pageName(1)));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(initialVersion);
  const pending = useRef<{ title: string | null; data: DesignDoc | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const liveRef = useRef<ReturnType<typeof useLiveDoc<DesignDoc>> | null>(null);

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
        liveRef.current?.saved(result.version);
        setStatus("saved");
        setError(null);
        continue;
      }
      if (result && !result.ok && result.error === "conflict") {
        setStatus("conflict");
        break;
      }
      const later = pending.current as { title: string | null; data: DesignDoc | null } | null;
      pending.current = { title: later?.title ?? next.title, data: later?.data ?? next.data };
      setStatus("error");
      setError(result && !result.ok ? (s.errors[result.error] ?? t.common.unknownError) : t.common.unknownError);
      break;
    }
    saving.current = false;
  }, [shortId, id]);

  const schedule = useCallback(
    (patch: { title?: string; data?: DesignDoc }) => {
      if (!canEdit || status === "conflict") return;
      pending.current = { title: patch.title ?? pending.current?.title ?? null, data: patch.data ?? pending.current?.data ?? null };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 900);
    },
    [canEdit, status, flush],
  );

  // The show and PDF read the saved deck: save first, then open the new tab
  // (opened at once, so the browser doesn't block it).
  const open = async (path: string) => {
    const win = window.open("about:blank", "_blank");
    if (timer.current) clearTimeout(timer.current);
    await flush();
    const url = workspacePath(shortId, `/boards/${id}${path}`);
    if (win) win.location.href = url;
    else window.location.href = url;
  };

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (pending.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  // Real-time co-editing: the room shares every change; one editor (the leader) saves.
  const live = useLiveDoc<DesignDoc>({
    shortId,
    objectId: id,
    spec: DESIGN_SPEC,
    initial,
    initialTitle,
    versionRef: version,
    pageCanEdit: canEdit,
    onTitle: setTitle,
    onSave: (data, name) => schedule({ data, title: name }),
  });
  useEffect(() => {
    liveRef.current = live;
  });
  const editable = live.canEdit && status !== "conflict";
  return (
    <StudioShell
      service="boards"
      backHref={workspacePath(shortId, "/boards")}
      backLabel={s.back}
      title={title}
      onTitle={
        canEdit
          ? (value) => {
              setTitle(value);
              if (!live.changeTitle(value)) schedule({ title: value });
            }
          : undefined
      }
      titleLabel={g.titlePlaceholder}
      untitled={s.untitled}
      status={status}
      savingLabel={s.saving}
      savedLabel={s.saved}
      center={undefined}
      presence={<LivePresence live={live} />}
      files={[]}
      access={
        access && (
          <ObjectAccessButton
            label={s.access}
            title={s.accessTitle}
            intro={s.accessIntro}
            access={access}
            members={members}
            actions={{
              setWorkspaceRole: (r) => setBoardWorkspaceRole(shortId, id, r),
              setMemberRole: (member, r) => setBoardMemberRole(shortId, id, member, r),
              setGroupRole: (group, r) => setBoardGroupRole(shortId, id, group, r),
            }}
          />
        )
      }
      primary={{ label: g.prototype.play, icon: "play", onSelect: () => void open("/prototype"), attrs: { "data-prototype-open": "" } }}
      more={[
        ...liveMenu(live),
        ...(canEdit
          ? [
              {
                label: s.toBin,
                icon: "trash" as const,
                danger: true,
                onSelect: async () => {
                  await trashBoard(shortId, id);
                  router.push(workspacePath(shortId, "/boards"));
                },
                attrs: { "data-to-bin": "" },
              },
            ]
          : []),
      ]}
      notices={<StudioNotices readOnly={canEdit ? null : s.readOnly} conflict={status === "conflict" ? s.conflict : null} reloadLabel={s.reload} error={status === "error" ? error : null} />}
    >
      <DesignEditor shortId={shortId} fileId={id} initial={initial} editable={editable} onChange={(doc) => schedule({ data: doc })} onPlay={(path) => void open(path)} live={live} canComment={role === "owner" || role === "editor" || role === "commenter"} />
    </StudioShell>
  );
}
