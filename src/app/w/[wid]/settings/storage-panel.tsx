"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateLocale, t } from "@/i18n";

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
const when = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// Settings → Storage: where the files live, connecting the team's Google Drive,
// moving existing files there and page backups.
export function StoragePanel({
  workspaceId,
  status,
  isOwner,
  configured,
  notice,
}: {
  workspaceId: string;
  status: StorageStatus;
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

  const move = async () => {
    setBusy(true);
    setMoveResult(null);
    let moved = 0;
    let failed = 0;
    // A few files per request until nothing is left (or only failures remain).
    for (let round = 0; round < 1000; round++) {
      const response = await fetch("/api/drive/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; moved?: number; failed?: number; remaining?: number };
      if (!result.ok) {
        failed += 1;
        break;
      }
      moved += result.moved ?? 0;
      setMoving({ moved, remaining: result.remaining ?? 0 });
      if (!result.remaining || !result.moved) {
        failed += result.failed ?? 0;
        break;
      }
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
    <div className="flex flex-col gap-8">
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "connected" ? "bg-accent/10" : "bg-danger/10 text-danger"}`}>
          {notice === "connected" ? st.connectedNotice : st.connectErrorNotice}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{st.heading}</h2>
        {drive ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">🟢 {st.connected(drive.account_email)}</p>
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
              {st.openFolder} ↗
            </a>
            <p className="text-xs text-muted">{st.sharedDriveHint}</p>
          </div>
        ) : (
          <>
            <p className="text-sm">{st.supabase((status.supabase_bytes / 1048576).toFixed(1), status.limit_mb)}</p>
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

      {drive && (
        <section className="space-y-3">
          <p className="text-sm">
            {st.filesTotal(status.total_files)} {status.to_move > 0 ? st.toMove(status.to_move) : st.allMoved}
          </p>
          {isOwner && status.to_move > 0 && drive.status === "ok" && (
            <button type="button" onClick={move} disabled={busy} className={primaryClass}>
              {st.move}
            </button>
          )}
          {moving && (
            <p role="status" className="text-sm">
              {st.moving(moving.moved, moving.remaining)}
            </p>
          )}
          {moveResult && (
            <p role="status" className="text-sm">
              {moveResult}
            </p>
          )}
        </section>
      )}

      {drive && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{st.backupHeading}</h2>
          <p className="text-sm text-muted">{st.backupIntro}</p>
          <p className="text-sm">{drive.last_backup_at ? st.lastBackup(when(drive.last_backup_at)) : st.noBackupYet}</p>
          {isOwner && drive.status === "ok" && (
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
      )}
    </div>
  );
}
