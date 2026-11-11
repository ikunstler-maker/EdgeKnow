"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { readBoard, type BoardData } from "@/lib/boards";
import { workspacePath } from "@/lib/paths";
import type { Person } from "@/lib/tasks";
import { ObjectAccessButton, type ObjectAccess } from "@/components/access/object-access";
import { saveBoard, setBoardGroupRole, setBoardMemberRole, setBoardWorkspaceRole, toggleBoardVote, trashBoard } from "@/app/board-actions";
import { BoardSessionBar, useBoardSession } from "./board-session-bar";
import type { BoardController, StickyInfo } from "./board-canvas";
import { StudioNotices, StudioShell } from "@/components/ui/studio-shell";

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
  const [controller, setController] = useState<BoardController | null>(null);
  const [stickies, setStickies] = useState<StickyInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const live = useBoardSession(shortId, id, stickies);
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

  const editable = canEdit && status !== "conflict";
  return (
    <StudioShell
      service="boards"
      backHref={workspacePath(shortId, "/boards")}
      backLabel={b.back}
      title={title}
      onTitle={
        canEdit
          ? (value) => {
              setTitle(value);
              schedule({ title: value });
            }
          : undefined
      }
      titleLabel={b.titlePlaceholder}
      untitled={b.untitled}
      status={status}
      savingLabel={b.saving}
      savedLabel={b.saved}
      center={undefined}
      files={[]}
      access={
        access && (
          <ObjectAccessButton
            label={b.access}
            title={b.accessTitle}
            intro={b.accessIntro}
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
      primary={undefined}
      more={[
        ...(canEdit
          ? [
              {
                label: b.toBin,
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
      notices={<StudioNotices readOnly={canEdit ? null : b.readOnly} conflict={status === "conflict" ? b.conflict : null} reloadLabel={b.reload} error={status === "error" ? error : null} />}
    >
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-hidden" data-board>
          <BoardCanvas
            shortId={shortId}
            boardId={id}
            onPictureError={(message) => {
              setStatus("error");
              setError(message);
            }}
            initial={initial}
            editable={editable}
            onChange={(data) => schedule({ data })}
            onReady={setController}
            onStickies={setStickies}
            onSelect={setSelected}
            votes={live.session ? { open: live.session.votingOpen, tally: live.session.tally, mine: live.session.mine, show: showResults } : null}
            onVote={async (sticky) => {
              const result = await toggleBoardVote(shortId, id, sticky);
              if (!result.ok) setError(b.errors[result.error] ?? t.common.unknownError);
              await live.refresh();
            }}
            chips={live.chips}
          />
        </div>
        <BoardSessionBar
          shortId={shortId}
          id={id}
          title={title}
          role={role}
          controller={controller}
          stickies={stickies}
          selected={selected}
          state={live}
          showResults={showResults}
          setShowResults={setShowResults}
        />
      </div>
    </StudioShell>
  );
}
