"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import type { TaskFilesStatus } from "@/lib/drive/workspace-files";
import { Icon } from "@/components/ui/icon";

const st = t.storage;

export type StorageStatus = {
  drive: {
    account_email: string;
    root_folder_id: string;
    status: "ok" | "error";
    connected_at: string;
    connected_by: string | null;
    last_backup_at: string | null;
  } | null;
  supabase_bytes: number;
  limit_mb: number;
  total_files: number;
  to_move: number;
};

const buttonClass = "min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-surface disabled:opacity-60";
const primaryClass = "min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";
const cardClass = "rounded-2xl border border-border p-4 sm:p-5";
const when = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// Settings → Storage: the workspace's one place for all its files (step U1),
// connecting the team's Google Drive, moving existing files there and page backups.
export function StoragePanel({
  workspaceId,
  status,
  taskFiles,
  team,
  isOwner,
  configured,
  notice,
}: {
  workspaceId: string;
  status: StorageStatus;
  taskFiles: TaskFilesStatus | null;
  team: boolean;
  isOwner: boolean;
  configured: boolean;
  notice: "connected" | "error" | null;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState<{ moved: number; remaining: number } | null>(null);
  const [moveResult, setMoveResult] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drive = status.drive;
  const connectHref = `/api/drive/connect?ws=${workspaceId}`;
  // Page images wait for the move only on a Drive; task files may also be on old personal or project Drives.
  const pageToMove = drive ? status.to_move : 0;
  const toMove = pageToMove + (taskFiles?.toMove ?? 0);
  const canMove = !drive || drive.status === "ok";
  // Page images still in EdgeKnow's storage are what goes onto the Drive.
  const addingBytes = (taskFiles?.toMoveBytes ?? 0) + (drive && pageToMove ? status.supabase_bytes : 0);

  // A few files per request until nothing is left (or only failures remain).
  const moveFrom = async (url: string, done: number) => {
    let moved = 0;
    for (let round = 0; round < 1000; round++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; moved?: number; failed?: number; remaining?: number };
      if (!result.ok) return { moved, failed: 1 };
      moved += result.moved ?? 0;
      setMoving({ moved: done + moved, remaining: result.remaining ?? 0 });
      if (!result.remaining || !result.moved) return { moved, failed: result.failed ?? 0 };
    }
    return { moved, failed: 0 };
  };

  const move = async () => {
    setBusy(true);
    setMoveResult(null);
    let moved = 0;
    let failed = 0;
    if (drive && status.to_move > 0) {
      const pages = await moveFrom("/api/drive/migrate", moved);
      moved += pages.moved;
      failed += pages.failed;
    }
    if (taskFiles && taskFiles.toMove > 0) {
      const tasks = await moveFrom("/api/tasks/files/move", moved);
      moved += tasks.moved;
      failed += tasks.failed;
    }
    setMoving(null);
    setMoveResult(failed ? st.moveFailed(failed) : st.moveDone(moved));
    setBusy(false);
    router.refresh();
  };

  const backupNow = async () => {
    setBusy(true);
    setBackup(st.backingUp);
    const response = await fetch("/api/drive/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; saved?: number; remaining?: number };
    setBackup(result.ok ? st.backupDone(result.saved ?? 0, result.remaining ?? 0) : t.common.unknownError);
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "connected" ? "bg-accent/10" : "bg-danger/10 text-danger"}`}>
          {notice === "connected" ? st.connectedNotice : st.connectErrorNotice}
        </p>
      )}

      <section className={`${cardClass} space-y-3`}>
        <h2 className="text-lg font-semibold">{st.heading}</h2>
        {drive ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            {st.connected(drive.account_email)}
          </p>
            <p className="text-muted">{st.connectedBy(drive.connected_by ?? "—", when(drive.connected_at))}</p>
            {drive.status === "error" && (
              <p role="alert" className="rounded-md bg-danger/10 px-2 py-1 text-danger">
                {st.error}
              </p>
            )}
            <a
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(drive.root_folder_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-accent underline"
            >
              {st.openFolder}
              <Icon name="arrow-up-right" size={14} className="ml-1 inline" />
            </a>
            <p className="text-xs text-muted">{st.sharedDriveHint}</p>
          </div>
        ) : (
          <>
            <p className="text-sm">{team ? st.teamStorage : st.supabase((status.supabase_bytes / 1048576).toFixed(1), status.limit_mb)}</p>
            <p className="text-sm text-muted">{st.driveIntro}</p>
          </>
        )}

        {!isOwner ? (
          <p className="text-sm text-muted">{st.ownerOnly}</p>
        ) : !configured ? (
          <p className="text-sm text-muted">{st.notConfigured}</p>
        ) : (
          <div className="space-y-1">
            <a href={connectHref} className={`inline-flex items-center ${drive ? buttonClass : primaryClass}`}>
              {drive ? st.connectOther : st.connect}
            </a>
            {drive && <p className="text-xs text-muted">{st.connectOtherHint}</p>}
          </div>
        )}
      </section>

      <section className={`${cardClass} space-y-2 text-sm`} data-one-storage>
        <p className="text-muted">{st.oneStorage}</p>
        <p>{st.pageFiles(status.total_files)}</p>
        {taskFiles && <p>{st.taskFiles(taskFiles.count, formatBytes(taskFiles.bytes))}</p>}
        <p data-not-here={toMove}>{toMove > 0 ? st.notHere(toMove) : st.allHere}</p>
        {toMove > 0 && canMove && <SpaceLine space={taskFiles?.space ?? null} adding={addingBytes} />}
        {isOwner && toMove > 0 && canMove && (
          <button type="button" onClick={move} disabled={busy} className={primaryClass}>
            {st.moveAll}
          </button>
        )}
        {moving && (
          <p role="status">
            {st.moving(moving.moved, moving.remaining)}
          </p>
        )}
        {moveResult && (
          <p role="status">
            {moveResult}
          </p>
        )}
      </section>

      <section className={`${cardClass} space-y-2`} data-backups>
        <h2 className="text-lg font-semibold">{st.backupHeading}</h2>
        <p className="text-sm text-muted">{st.backupIntro}</p>
        {drive ? (
          <p className="text-sm">{drive.last_backup_at ? st.lastBackup(when(drive.last_backup_at)) : st.noBackupYet}</p>
        ) : (
          <p className="text-sm text-muted">{st.backupNeedsDrive}</p>
        )}
        {isOwner && drive?.status === "ok" && (
          <button type="button" onClick={backupNow} disabled={busy} className={buttonClass}>
            {st.backupNow}
          </button>
        )}
        {backup && (
          <p role="status" className="text-sm">
            {backup}
          </p>
        )}
      </section>
    </div>
  );
}

// The space where the files go: free now, and after moving the rest.
function SpaceLine({ space, adding }: { space: { limit: number | null; used: number } | null; adding: number }) {
  if (!space) return <p className="text-muted">{st.spaceUnknown}</p>;
  if (!space.limit) return <p className="text-muted" data-space-now>{st.spaceUnlimited}</p>;
  const free = Math.max(0, space.limit - space.used);
  const after = free - adding;
  return (
    <p>
      <span data-space-now>{st.spaceNow(formatBytes(free), formatBytes(space.limit))}</span> <span data-space-after>{st.spaceAfter(formatBytes(Math.max(0, after)))}</span>
      {after < 0 && <span className="block text-danger">{st.notEnough}</span>}
    </p>
  );
}
