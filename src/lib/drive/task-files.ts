import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DriveError, driveApi } from "./google-drive";
import { ACCOUNT_COLUMNS, accountAsConnection, activeConnection, connectionById, noteDriveError, refreshTokenOf, type DriveAccount, type DriveConnection } from "./storage";
import { teamAdmin } from "@/lib/team-db/files";
import { teamDatabase, teamReady } from "@/lib/team-db/sync";

// Files attached to tasks: where a project keeps them (the uploader's own
// Google Drive, the wiki's Drive, the project's own Drive or EdgeKnow's
// storage), and putting, reading and moving their bytes. Server only: the
// Drive accesses and the storage keys never reach the browser.

export type FilesTarget = "personal" | "wiki" | "project" | "edgeknow";
export const FILES_TARGETS: FilesTarget[] = ["personal", "wiki", "project", "edgeknow"];

export type TaskFileRow = {
  id: string;
  workspace_id: string;
  task_id: string;
  name: string;
  mime_type: string;
  bytes: number;
  storage_path: string;
  storage_backend: "pending" | "supabase" | "drive";
  drive_source: "personal" | "wiki" | "project" | null;
  drive_account_id: string | null;
  drive_file_id: string | null;
  uploaded_by: string | null;
  created_at: string;
};
export const TASK_FILE_COLUMNS =
  "id, workspace_id, task_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by, created_at";

// Their own private bucket (the wiki one takes only images).
export const TASK_BUCKET = "task-files";

export const MAX_TASK_FILE_BYTES = 4 * 1024 * 1024;

// Where a workspace's rows and EdgeKnow-storage bytes are: centrally, or in the team's own database.
export async function filesHome(admin: SupabaseClient, workspaceId: string): Promise<{ rows: SupabaseClient; team: boolean }> {
  const db = await teamDatabase(admin, workspaceId);
  return db && teamReady(db) ? { rows: teamAdmin(db), team: true } : { rows: admin, team: false };
}

export async function personalDrive(admin: SupabaseClient, workspaceId: string, userId: string) {
  const { data } = await admin.from("drive_accounts").select(ACCOUNT_COLUMNS).eq("workspace_id", workspaceId).eq("purpose", "personal").eq("user_id", userId).eq("active", true).maybeSingle();
  return data ? accountAsConnection(data as DriveAccount) : null;
}

export async function projectDrive(admin: SupabaseClient, workspaceId: string, projectId: string) {
  const { data } = await admin.from("drive_accounts").select(ACCOUNT_COLUMNS).eq("workspace_id", workspaceId).eq("purpose", "project").eq("project_id", projectId).eq("active", true).maybeSingle();
  return data ? accountAsConnection(data as DriveAccount) : null;
}

export type Destination = { kind: "drive"; source: "personal" | "wiki" | "project"; connection: DriveConnection } | { kind: "storage" };

// Where a new file of `uploader` goes, or why it can't go there.
export async function destinationFor(
  admin: SupabaseClient,
  target: FilesTarget,
  workspaceId: string,
  projectId: string,
  uploader: string | null,
): Promise<Destination | { error: "needs_personal_drive" | "drive_not_connected" | "drive_error" }> {
  if (target === "edgeknow") return { kind: "storage" };
  const connection =
    target === "personal"
      ? uploader
        ? await personalDrive(admin, workspaceId, uploader)
        : null
      : target === "wiki"
        ? await activeConnection(admin, workspaceId)
        : await projectDrive(admin, workspaceId, projectId);
  if (!connection) return { error: target === "personal" ? "needs_personal_drive" : "drive_not_connected" };
  if (connection.status !== "ok") return { error: "drive_error" };
  return { kind: "drive", source: target, connection };
}

const nameOnDrive = (row: Pick<TaskFileRow, "id" | "name">) => `${row.id.slice(0, 8)} ${row.name}`.slice(0, 200);

// Puts the bytes at the destination and records where (`rows`: the database with the file's record).
export async function storeTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: TaskFileRow, bytes: Uint8Array, to: Destination) {
  if (to.kind === "storage") {
    const { error } = await rows.storage.from(TASK_BUCKET).upload(row.storage_path, bytes, { contentType: row.mime_type, upsert: true });
    if (error) throw new Error(`storage: ${error.message}`);
    const { error: updateError } = await rows
      .from("task_files")
      .update({ storage_backend: "supabase", drive_source: null, drive_account_id: null, drive_file_id: null })
      .eq("id", row.id);
    if (updateError) throw new Error("record update failed");
    return;
  }
  let fileId: string;
  try {
    fileId = await driveApi().upload(refreshTokenOf(to.connection), to.connection.files_folder_id, nameOnDrive(row), row.mime_type, bytes);
  } catch (error) {
    await noteDriveError(admin, to.connection, error);
    throw error;
  }
  const { error } = await rows
    .from("task_files")
    .update({ storage_backend: "drive", drive_source: to.source, drive_account_id: to.connection.id, drive_file_id: fileId })
    .eq("id", row.id);
  if (error) throw new Error("record update failed");
}

export async function readTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: TaskFileRow): Promise<Uint8Array> {
  if (row.storage_backend === "drive") {
    const connection = row.drive_account_id ? await connectionById(admin, row.drive_account_id) : null;
    if (!connection || !row.drive_file_id) throw new DriveError("connection gone", 404);
    try {
      return (await driveApi().download(refreshTokenOf(connection), row.drive_file_id)).bytes;
    } catch (error) {
      await noteDriveError(admin, connection, error);
      throw error;
    }
  }
  if (row.storage_backend !== "supabase") throw new DriveError("not stored yet", 404);
  const { data, error } = await rows.storage.from(TASK_BUCKET).download(row.storage_path);
  if (error || !data) throw new DriveError("storage download failed", 404);
  return new Uint8Array(await data.arrayBuffer());
}

// Copies a file to another place, then frees the old one (a Drive copy is removed
// with that Drive's own access; a Drive that is gone has nothing to remove).
export async function moveTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: TaskFileRow, to: Destination) {
  const bytes = await readTaskFile(admin, rows, row);
  await storeTaskFile(admin, rows, row, bytes, to);
  if (row.storage_backend === "supabase") await rows.storage.from(TASK_BUCKET).remove([row.storage_path]);
  if (row.storage_backend === "drive" && row.drive_account_id && row.drive_file_id) {
    const connection = await connectionById(admin, row.drive_account_id);
    if (connection) await driveApi().remove(refreshTokenOf(connection), row.drive_file_id).catch(() => {});
  }
}

// Is a file already where the destination says?
export function isAt(row: TaskFileRow, to: Destination) {
  return to.kind === "storage" ? row.storage_backend === "supabase" : row.storage_backend === "drive" && row.drive_account_id === to.connection.id;
}

// Free space at a destination, in bytes (null: unknown or unlimited).
export async function spaceAt(admin: SupabaseClient, to: Destination, workspaceId: string, team: boolean): Promise<{ limit: number | null; used: number } | null> {
  if (to.kind === "drive") {
    try {
      const { limit, usage } = await driveApi().quota(refreshTokenOf(to.connection));
      return { limit, used: usage };
    } catch {
      return null;
    }
  }
  if (team) {
    // A team's own Supabase project: the free plan holds 1 GB of files.
    const { data } = await admin.from("team_databases").select("storage_bytes").eq("workspace_id", workspaceId).maybeSingle();
    return { limit: 1024 ** 3, used: Number(data?.storage_bytes ?? 0) };
  }
  const [{ data: ws }, { data: images }, { data: files }] = await Promise.all([
    admin.from("workspaces").select("storage_limit_mb").eq("id", workspaceId).maybeSingle(),
    admin.from("attachments").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
    admin.from("task_files").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
  ]);
  const sum = (list: { bytes: number }[] | null) => (list ?? []).reduce((total, r) => total + Number(r.bytes), 0);
  return { limit: Number(ws?.storage_limit_mb ?? 0) * 1024 * 1024, used: sum(images) + sum(files) };
}

// The first bytes must fit the declared type: nothing else is stored or served.
export function taskFileLooksLike(mimeType: string, bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  switch (mimeType) {
    case "image/png":
      return bytes[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "application/pdf":
      return ascii(0, 5) === "%PDF-";
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return zip;
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return ole;
    case "text/plain":
    case "text/csv":
      return !bytes.includes(0);
    default:
      return false;
  }
}

// Shown in the browser: images and PDFs; everything else is downloaded, never run.
export const showsInline = (mimeType: string) => mimeType.startsWith("image/") || mimeType === "application/pdf";
