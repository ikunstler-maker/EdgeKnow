"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import type { ActionResult } from "@/lib/action-result";
import type { MemberFilesOverview, Space } from "@/lib/drive/member-files";
import { copyMemberFiles, getMemberFiles } from "@/app/member-file-actions";

const m = t.memberFiles;
type Choice = "wiki" | "edgeknow" | "project" | "zip" | "keep";
const buttonClass = "min-h-11 rounded-md border border-border px-4 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

function SpaceLines({ space, adding }: { space: Space; adding: number }) {
  if (!space) return <span className="block text-xs text-muted">{m.spaceUnknown}</span>;
  if (space.limit === null) return <span className="block text-xs text-muted">{m.spaceUnlimited}</span>;
  const free = space.limit - space.used;
  return (
    <span className="block text-xs text-muted" data-member-space>
      {m.spaceNow(formatBytes(free), formatBytes(space.limit))} · {m.spaceAfter(formatBytes(free - adding))}
      {free < adding && <span className="block text-danger">{m.notEnough}</span>}
    </span>
  );
}

// Before removing someone: their task files on their own Drive — copy them to the
// cloud or download them as an archive — with how much they weigh and how much space is left.
export function RemoveMemberDialog({
  workspaceId,
  member,
  onRemove,
  onClose,
}: {
  workspaceId: string;
  member: { userId: string; email: string; name: string | null };
  onRemove: () => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [overview, setOverview] = useState<MemberFilesOverview | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    getMemberFiles(workspaceId, member.userId).then((result) => {
      if (!result.ok) return setError(t.common.unknownError);
      setOverview(result.overview);
      setChoice(result.overview.count === 0 ? "keep" : result.overview.wiki ? "wiki" : "edgeknow");
    });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [workspaceId, member.userId, onClose]);

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      if (choice === "wiki" || choice === "edgeknow" || choice === "project") {
        let done = 0;
        for (let round = 0; round < 100; round++) {
          setStatus(m.copying(done, overview?.count ?? 0));
          const result = await copyMemberFiles(workspaceId, member.userId, choice);
          if (!result.ok) return setError(t.common.unknownError);
          done += result.moved;
          if (result.failed) {
            setStatus(null);
            return setError(m.copyFailed(result.failed));
          }
          if (!result.remaining || !result.moved) break;
        }
      }
      if (choice === "zip") {
        // The archive downloads while the dialog goes on; removal waits a moment for it to start.
        const link = document.createElement("a");
        link.href = `/api/members/files?ws=${workspaceId}&user=${member.userId}`;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      setStatus(null);
      const removed = await onRemove();
      if (removed.ok) onClose();
      else setError(t.settings.errors[removed.error] ?? t.common.unknownError);
    });

  const label = overview && overview.count > 0 ? (choice === "zip" ? m.downloadAndRemove : choice === "keep" ? m.remove : m.copyAndRemove) : m.remove;
  const option = (value: Choice, title: string, extra?: React.ReactNode, disabled = false) => (
    <label className={`flex gap-3 rounded-lg border p-3 ${disabled ? "opacity-50" : "cursor-pointer"} ${choice === value ? "border-accent bg-accent/5" : "border-border"}`}>
      <input type="radio" name="member-files" value={value} checked={choice === value} disabled={disabled || pending} onChange={() => setChoice(value)} className="mt-1 h-4 w-4" />
      <span className="flex-1">
        <span className="block">{title}</span>
        {extra}
      </span>
    </label>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !pending && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={m.title(member.email)} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">{m.title(member.name ?? member.email)}</h2>
          <p className="text-sm text-muted">{m.pagesStay}</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" data-member-files>
          {!overview ? (
            <p className="text-muted">{error ?? m.loading}</p>
          ) : overview.count === 0 ? (
            <p className="text-muted">{m.none}</p>
          ) : (
            <>
              <p data-member-files-found>{m.found(overview.count, formatBytes(overview.bytes))}</p>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-medium text-muted">{m.choose}</legend>
                {overview.wiki && option("wiki", m.wiki(overview.wiki.email), <SpaceLines space={overview.wiki.space} adding={overview.bytes} />)}
                {option("edgeknow", overview.edgeknow.team ? m.teamStorage : m.edgeknow, <SpaceLines space={overview.edgeknow.space} adding={overview.bytes} />)}
                {overview.projects.length > 0 &&
                  option(
                    "project",
                    m.projects,
                    <>
                      {overview.projects.map((p) => (
                        <span key={p.key} className="mt-1 block text-xs">
                          {m.projectLine(p.key, p.email, p.count, formatBytes(p.bytes))}
                          <SpaceLines space={p.space} adding={p.bytes} />
                        </span>
                      ))}
                      {overview.withoutProjectDrive > 0 && <span className="mt-1 block text-xs text-muted">{m.projectMissing(overview.withoutProjectDrive)}</span>}
                    </>,
                  )}
                {option("zip", m.zip, <span className="block text-xs text-muted">{m.zipHint(formatBytes(overview.bytes))}</span>)}
                {option("keep", m.keep)}
              </fieldset>
            </>
          )}
          {status && (
            <p role="status" className="text-muted">
              {status}
            </p>
          )}
          {error && overview && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" disabled={pending} onClick={onClose} className={buttonClass}>
            {m.cancel}
          </button>
          <button type="button" disabled={pending || !overview || !choice} onClick={confirm} className={`${buttonClass} border-danger text-danger`}>
            {label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
