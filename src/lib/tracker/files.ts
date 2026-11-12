import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DriveError, driveApi } from "@/lib/drive/google-drive";
import { noteDriveError, refreshTokenOf } from "@/lib/drive/storage";
import { workspaceDestination } from "@/lib/drive/task-files";
import { fileLimit, toPersonItems, type ImportMapping, type TrackerFile } from "@/lib/tracker-convert";
import { TrackerError, type TrackerAccess, type TrackerApi } from "@/lib/tracker/api";
import type { ImportProgress } from "@/lib/tracker/types";

// Moving the tracker's files to the team's Google Drive (Rukh 3б). A file goes straight
// from the tracker to the Drive in parts of 8 MB, never whole in memory; a large one takes
// several steps, each continuing where the last one stopped. What can't come is noted as
// a gap, so it can be pulled again later.

type Ref = { key: string; file: TrackerFile };
// Where the work stands between steps. Kept with the import's mapping (server only):
// the upload session is an address anyone could write to.
export type FileWork = { pending: Ref[]; transfer: (Ref & { session: string; offset: number; connection: string }) | null; last: boolean };
export const newFileWork = (): FileWork => ({ pending: [], transfer: null, last: false });

const PART = 8 * 1024 * 1024;
const PAGE = 20;
type Gap = "too_big" | "empty" | "no_drive" | "no_space" | "tracker_error" | "drive_error";

export async function moveFilesStep(opts: {
  admin: SupabaseClient;
  rows: SupabaseClient;
  api: TrackerApi;
  access: TrackerAccess;
  workspaceId: string;
  projectId: string;
  sourceProject: string;
  mapping: ImportMapping;
  work: FileWork;
  progress: ImportProgress;
  budgetMs?: number;
}): Promise<{ done: boolean }> {
  const { admin, rows, api, access, work, progress } = opts;
  const until = Date.now() + (opts.budgetMs ?? 8_000);
  const destination = await workspaceDestination(admin, opts.workspaceId);
  const drive = "kind" in destination && destination.kind === "drive" ? destination.connection : null;
  const token = drive ? refreshTokenOf(drive) : "";
  let space: number | null = null;
  if (drive) {
    const quota = await driveApi()
      .quota(token)
      .catch(() => null);
    space = quota?.limit ? quota.limit - quota.usage : null;
  }
  const gap = async (ref: Ref, reason: Gap) => {
    await rows.rpc("note_import_gap", { target_project: opts.projectId, item: { external_key: ref.key, external_id: ref.file.id, name: ref.file.name, bytes: ref.file.size, reason } });
    progress.filesMissed = (progress.filesMissed ?? 0) + 1;
  };

  while (Date.now() < until) {
    if (work.transfer) {
      const now = work.transfer;
      if (!drive || drive.id !== now.connection) {
        await gap(now, "drive_error");
        work.transfer = null;
        continue;
      }
      try {
        const fileId = await sendParts(api, access, token, now, until);
        if (!fileId) break; // out of time: the next step continues
        const { data } = await rows.rpc("import_task_file", {
          target_project: opts.projectId,
          item: { external_key: now.key, external_id: now.file.id, name: now.file.name, mime_type: now.file.mime, bytes: now.file.size, drive_account_id: drive.id, drive_file_id: fileId, author_ext: now.file.author?.id ?? null, created_at: now.file.created || null },
        });
        if ((data as { ok?: boolean } | null)?.ok) {
          progress.files = (progress.files ?? 0) + 1;
          progress.fileBytes = (progress.fileBytes ?? 0) + now.file.size;
          if (space !== null) space -= now.file.size;
        } else {
          await driveApi().remove(token, fileId).catch(() => {});
          await gap(now, "drive_error");
        }
      } catch (error) {
        // A key that stopped working stops the move; anything else is this file's own trouble.
        if (error instanceof TrackerError && error.code === "auth") throw error;
        if (error instanceof DriveError) await noteDriveError(admin, drive, error);
        await gap(now, error instanceof DriveError ? "drive_error" : "tracker_error");
      }
      work.transfer = null;
      continue;
    }
    const next = work.pending.shift();
    if (next) {
      if (next.file.size <= 0) await gap(next, "empty");
      else if (next.file.size > fileLimit(next.file)) await gap(next, "too_big");
      else if (!drive) await gap(next, "no_drive");
      else if (space !== null && next.file.size > space) await gap(next, "no_space");
      else {
        try {
          const session = await driveApi().beginUpload(token, drive.files_folder_id, `${next.key} ${next.file.name}`.slice(0, 200), next.file.mime, next.file.size);
          work.transfer = { ...next, session, offset: 0, connection: drive.id };
        } catch (error) {
          await noteDriveError(admin, drive, error);
          await gap(next, "drive_error");
        }
      }
      continue;
    }
    if (work.last) return { done: true };
    const page = await api.files(access, opts.sourceProject, progress.cursor, PAGE);
    progress.cursor = page.next;
    work.last = !page.next;
    const found = page.items.flatMap((item) => item.files.map((file) => ({ key: item.key, file })));
    if (!found.length) continue;
    // Files an earlier run has already put on the Drive are left alone.
    const { data: have } = await rows.from("task_files").select("external_id").eq("workspace_id", opts.workspaceId).eq("storage_backend", "drive").in("external_id", found.map((f) => f.file.id));
    const moved = new Set(((have ?? []) as { external_id: string }[]).map((f) => f.external_id));
    progress.filesKept = (progress.filesKept ?? 0) + found.filter((f) => moved.has(f.file.id)).length;
    work.pending = found.filter((f) => !moved.has(f.file.id));
    const people = toPersonItems(found.flatMap((f) => (f.file.author ? [f.file.author] : [])), opts.mapping);
    if (people.length) await rows.rpc("import_people", { target_project: opts.projectId, items: people });
  }
  return { done: false };
}

// Sends the file on from where the transfer stands. Returns the Drive file's id when the
// last part is in, or null when time ran out first (the offset is kept in `transfer`).
async function sendParts(api: TrackerApi, access: TrackerAccess, token: string, transfer: NonNullable<FileWork["transfer"]>, until: number): Promise<string | null> {
  const size = transfer.file.size;
  const source = await api.fileStream(access, transfer.file.id, transfer.offset);
  const reader = source.body.getReader();
  let skip = source.ranged ? 0 : transfer.offset;
  let held: Uint8Array[] = [];
  let heldBytes = 0;
  const take = (count: number) => {
    const all = Buffer.concat(held);
    held = count < all.length ? [new Uint8Array(all.subarray(count))] : [];
    heldBytes = all.length - count;
    return new Uint8Array(all.subarray(0, count));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        let chunk = value;
        if (skip > 0) {
          const drop = Math.min(skip, chunk.length);
          skip -= drop;
          chunk = chunk.subarray(drop);
        }
        if (chunk.length) {
          held.push(chunk);
          heldBytes += chunk.length;
        }
      }
      while (heldBytes >= PART && transfer.offset + PART < size) {
        const part = take(PART);
        await driveApi().sendPart(token, transfer.session, part, transfer.offset, size);
        transfer.offset += part.length;
        if (Date.now() > until) return null;
      }
      if (done) break;
      if (transfer.offset + heldBytes > size) throw new TrackerError("bad_answer");
    }
    // The last part: exactly what is left of the size the tracker named.
    if (transfer.offset + heldBytes !== size) throw new TrackerError("bad_answer");
    const { fileId } = await driveApi().sendPart(token, transfer.session, take(heldBytes), transfer.offset, size);
    if (!fileId) throw new DriveError("upload not finished", 502);
    return fileId;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
