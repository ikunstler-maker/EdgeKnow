import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DriveError, driveApi } from "./google-drive";
import { ACCOUNT_COLUMNS, accountAsConnection, activeConnection, connectionById, noteDriveError, refreshTokenOf, type DriveAccount, type DriveConnection } from "./storage";
import { teamAdmin } from "@/lib/team-db/files";
import { teamDatabase, teamReady } from "@/lib/team-db/sync";

// Files attached to tasks: where they go (the workspace's one storage), and
// putting, reading and moving their bytes. Older files may still be on a
// person's or a project's Drive until moved. Server only: the
// Drive accesses and the storage keys never reach the browser.

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
// A board picture (object_files) is kept the same way: the same bucket and Drive
// folder, its own table.
// Chat files (chat_files) too, in their own bucket.
// Vault's own files (vault_items, `vault: true`) too, in their own bucket.
export type StoredFile = Omit<TaskFileRow, "task_id"> & { task_id?: string; object_id?: string; channel_id?: string; vault?: boolean };
export const OBJECT_FILE_COLUMNS =
  "id, workspace_id, object_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by, created_at";
const tableOf = (row: StoredFile) => (row.vault ? "vault_items" : row.channel_id ? "chat_files" : row.object_id ? "object_files" : "task_files");
export const CHAT_BUCKET = "chat-files";
export const VAULT_BUCKET = "vault-files";
const bucketOf = (row: StoredFile) => (row.vault ? VAULT_BUCKET : row.channel_id ? CHAT_BUCKET : TASK_BUCKET);

export const VAULT_FILE_COLUMNS =
  "id, workspace_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by:owner_id, created_at, large";

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

export async function projectDrive(admin: SupabaseClient, workspaceId: string, projectId: string) {
  const { data } = await admin.from("drive_accounts").select(ACCOUNT_COLUMNS).eq("workspace_id", workspaceId).eq("purpose", "project").eq("project_id", projectId).eq("active", true).maybeSingle();
  return data ? accountAsConnection(data as DriveAccount) : null;
}

export type Destination = { kind: "drive"; source: "personal" | "wiki" | "project"; connection: DriveConnection } | { kind: "storage" };

// One storage per workspace (step U1): every new file goes where the wiki keeps
// its files — its Google Drive when one is connected, otherwise EdgeKnow's
// storage (or the team's own). Files from before stay readable where they are
// until they are moved (Settings → Storage).
export async function workspaceDestination(admin: SupabaseClient, workspaceId: string): Promise<Destination | { error: "drive_error" }> {
  const connection = await activeConnection(admin, workspaceId);
  if (!connection) return { kind: "storage" };
  if (connection.status !== "ok") return { error: "drive_error" };
  return { kind: "drive", source: "wiki", connection };
}

const nameOnDrive = (row: Pick<StoredFile, "id" | "name">) => `${row.id.slice(0, 8)} ${row.name}`.slice(0, 200);

// Puts the bytes at the destination and records where (`rows`: the database with the file's record).
export async function storeTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: StoredFile, bytes: Uint8Array, to: Destination) {
  if (to.kind === "storage") {
    const { error } = await rows.storage.from(bucketOf(row)).upload(row.storage_path, bytes, { contentType: row.mime_type, upsert: true });
    if (error) throw new Error(`storage: ${error.message}`);
    const { error: updateError } = await rows
      .from(tableOf(row))
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
    .from(tableOf(row))
    .update({ storage_backend: "drive", drive_source: to.source, drive_account_id: to.connection.id, drive_file_id: fileId })
    .eq("id", row.id);
  if (error) throw new Error("record update failed");
}

export async function readTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: StoredFile): Promise<Uint8Array> {
  // A large file from another tracker is only ever streamed (see streamTaskFile): moving
  // it between storages in one piece would not fit in memory.
  if (Number(row.bytes) > 64 * 1024 * 1024) throw new DriveError("too large to read whole", 413);
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
  const { data, error } = await rows.storage.from(bucketOf(row)).download(row.storage_path);
  if (error || !data) throw new DriveError("storage download failed", 404);
  return new Uint8Array(await data.arrayBuffer());
}

// Copies a file to another place, then frees the old one (a Drive copy is removed
// with that Drive's own access; a Drive that is gone has nothing to remove).
// `keepOld`: a person's own Drive keeps its copy when they leave — it's theirs.
export async function moveTaskFile(admin: SupabaseClient, rows: SupabaseClient, row: StoredFile, to: Destination, keepOld = false) {
  const bytes = await readTaskFile(admin, rows, row);
  await storeTaskFile(admin, rows, row, bytes, to);
  if (keepOld) return;
  if (row.storage_backend === "supabase") await rows.storage.from(bucketOf(row)).remove([row.storage_path]);
  if (row.storage_backend === "drive" && row.drive_account_id && row.drive_file_id) {
    const connection = await connectionById(admin, row.drive_account_id);
    if (connection) await driveApi().remove(refreshTokenOf(connection), row.drive_file_id).catch(() => {});
  }
}

// Is a file already where the destination says?
export function isAt(row: StoredFile, to: Destination) {
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
  const [{ data: ws }, { data: images }, { data: files }, { data: pictures }, { data: chat }, { data: vault }] = await Promise.all([
    admin.from("workspaces").select("storage_limit_mb").eq("id", workspaceId).maybeSingle(),
    admin.from("attachments").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
    admin.from("task_files").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
    admin.from("object_files").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
    admin.from("chat_files").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
    admin.from("vault_items").select("bytes").eq("workspace_id", workspaceId).eq("storage_backend", "supabase"),
  ]);
  const sum = (list: { bytes: number }[] | null) => (list ?? []).reduce((total, r) => total + Number(r.bytes), 0);
  return { limit: Number(ws?.storage_limit_mb ?? 0) * 1024 * 1024, used: sum(images) + sum(files) + sum(pictures) + sum(chat) + sum(vault) };
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
// (A file from another tracker can be of any kind: only these plain picture kinds and PDF are shown.)
export const showsInline = (mimeType: string) => ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mimeType);

// A file too large to hold in memory is handed on as a stream, straight from the Drive.
export const STREAM_FROM_BYTES = 4 * 1024 * 1024;
export async function streamTaskFile(admin: SupabaseClient, row: StoredFile, range: string | null) {
  const connection = row.drive_account_id ? await connectionById(admin, row.drive_account_id) : null;
  if (row.storage_backend !== "drive" || !connection || !row.drive_file_id) throw new DriveError("connection gone", 404);
  try {
    return await driveApi().stream(refreshTokenOf(connection), row.drive_file_id, range);
  } catch (error) {
    await noteDriveError(admin, connection, error);
    throw error;
  }
}

// Chat files: what tasks take, plus recorded voice (WebM, Ogg, MP4 audio) and MP3.
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;
export function chatFileLooksLike(mimeType: string, bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  switch (mimeType) {
    case "audio/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/mp4":
      return ascii(4, 8) === "ftyp";
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default:
      return taskFileLooksLike(mimeType, bytes);
  }
}
