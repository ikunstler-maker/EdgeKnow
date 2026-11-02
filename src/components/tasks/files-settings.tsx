"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { t } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { updateTaskProject } from "@/app/task-actions";
import { moveTaskFiles, taskFilesOverview, type FilesOverview } from "@/app/task-file-actions";

const s = t.tasks.files.settings;
const TARGETS = ["personal", "wiki", "project", "edgeknow"] as const;
const buttonClass = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 md:min-h-9";

// For those who manage a project: where task files go, how much there is, and moving it.
export function FilesSettingsButton({ shortId, workspaceId, project, teamStorage }: { shortId: string; workspaceId: string; project: { id: string; key: string }; teamStorage: boolean }) {
  const params = useSearchParams();
  // Back from connecting a Drive: open again.
  const [open, setOpen] = useState(params.get("files") === "1");
  // The dialog lives in document.body: only in the browser.
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center ${buttonClass}`}>
        {s.button}
      </button>
      {open && inBrowser && <FilesDialog shortId={shortId} workspaceId={workspaceId} project={project} teamStorage={teamStorage} onClose={() => setOpen(false)} />}
    </>
  );
}

function FilesDialog({ shortId, workspaceId, project, teamStorage, onClose }: { shortId: string; workspaceId: string; project: { id: string; key: string }; teamStorage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [overview, setOverview] = useState<FilesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const load = useCallback(
    () =>
      taskFilesOverview(shortId, project.id).then((result) => {
        if (result.ok) setOverview(result.overview);
        else setError(t.tasks.errors[result.error] ?? t.common.unknownError);
      }),
    [shortId, project.id],
  );
  useEffect(() => {
    taskFilesOverview(shortId, project.id).then((result) => {
      if (result.ok) setOverview(result.overview);
      else setError(t.tasks.errors[result.error] ?? t.common.unknownError);
    });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortId, project.id, onClose]);

  const choose = (target: string) =>
    startTransition(async () => {
      setNotice(null);
      const result = await updateTaskProject(project.id, { files_target: target });
      setError(result.ok ? null : (t.tasks.errors[result.error] ?? t.common.unknownError));
      await load();
      router.refresh();
    });
  const move = () =>
    startTransition(async () => {
      let moved = 0;
      let failed = 0;
      setNotice(s.moving);
      // A call moves for up to ~20 seconds; keep going while it makes progress.
      for (let round = 0; round < 50; round++) {
        const result = await moveTaskFiles(shortId, project.id);
        if (!result.ok) {
          setError(t.tasks.errors[result.error] ?? t.common.unknownError);
          break;
        }
        moved += result.moved;
        failed = result.failed;
        if (!result.remaining || !result.moved) break;
      }
      setNotice([s.moved(moved), failed ? s.failed(failed) : ""].filter(Boolean).join(" · "));
      await load();
      router.refresh();
    });

  const back = `/w/${shortId}/tasks/${project.key}?files=1`;
  const connectProject = `/api/drive/connect?ws=${workspaceId}&purpose=project&project=${project.id}&back=${encodeURIComponent(back)}`;
  const connectMine = `/api/drive/connect?ws=${workspaceId}&purpose=personal&back=${encodeURIComponent(back)}`;
  const space = overview?.space;
  const free = space && space.limit !== null ? space.limit - space.used : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={s.title} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-background shadow-xl sm:rounded-xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 className="flex-1 font-semibold">{s.title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="min-h-11 min-w-11">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <p className="text-muted">{s.intro}</p>
          {!overview ? (
            <p className="text-muted">{error ?? s.loading}</p>
          ) : (
            <>
              <fieldset className="space-y-2" disabled={pending}>
                {TARGETS.map((target) => (
                  <label key={target} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${overview.target === target ? "border-accent bg-accent/5" : "border-border"}`}>
                    <input type="radio" name="files-target" value={target} checked={overview.target === target} onChange={() => choose(target)} className="mt-1 h-4 w-4" />
                    <span className="flex-1 space-y-1">
                      <span className="block font-medium">{target === "edgeknow" && teamStorage ? s.teamStorage : s.targets[target]}</span>
                      {target === "personal" && (
                        <>
                          <span className="block text-xs text-muted">{s.personalWarning}</span>
                          <span className="block text-xs">
                            {overview.drives.personal ? s.yourDrive(overview.drives.personal) : <a href={connectMine} className="text-accent hover:underline">{t.tasks.files.connectMine}</a>}
                          </span>
                        </>
                      )}
                      {target === "wiki" && <span className="block text-xs text-muted">{overview.drives.wiki ? s.connected(overview.drives.wiki) : `${s.notConnected}. ${s.wikiInSettings}`}</span>}
                      {target === "project" && (
                        <span className="block text-xs">
                          {overview.drives.project ? `${s.connected(overview.drives.project)} · ` : `${s.notConnected} · `}
                          <a href={connectProject} className="text-accent hover:underline" data-connect-project-drive>
                            {overview.drives.project ? s.connectOther : s.connectProject}
                          </a>
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1 rounded-lg bg-surface p-3" data-files-summary>
                <p>{s.filesNow(overview.files.count, formatBytes(overview.files.bytes))}</p>
                <p>{s.toMove(overview.toMove.count, formatBytes(overview.toMove.bytes))}</p>
                {overview.toMove.waiting > 0 && <p className="text-muted">{s.waiting(overview.toMove.waiting)}</p>}
                {overview.target !== "personal" &&
                  (space === null || space === undefined ? (
                    <p className="text-muted">{s.spaceUnknown}</p>
                  ) : free === null ? (
                    <p>{s.spaceUnlimited}</p>
                  ) : (
                    <>
                      <p data-space-now>{s.spaceNow(formatBytes(free), formatBytes(space.limit!))}</p>
                      <p data-space-after>{s.spaceAfter(formatBytes(free - overview.toMove.bytes))}</p>
                      {free < overview.toMove.bytes && <p className="text-danger">{s.notEnough}</p>}
                    </>
                  ))}
              </div>
              {overview.toMove.count > 0 && (
                <button type="button" disabled={pending} onClick={move} className={buttonClass}>
                  {pending && notice === s.moving ? s.moving : s.move}
                </button>
              )}
            </>
          )}
          {notice && notice !== s.moving && (
            <p role="status" className="text-muted">
              {notice}
            </p>
          )}
          {error && overview && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
