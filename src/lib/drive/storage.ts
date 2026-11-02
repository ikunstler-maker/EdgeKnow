import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DriveError, driveApi } from "./google-drive";
import { decrypt } from "./secret-box";

// Where a workspace's files live and how to move them. All of this runs on the
// server with the secret-key client: users never get the Drive access itself.

export type DriveConnection = {
  id: string;
  workspace_id: string;
  account_email: string;
  root_folder_id: string;
  files_folder_id: string;
  backups_folder_id: string;
  token_encrypted: string;
  status: "ok" | "error";
  active: boolean;
};

export type AttachmentRow = {
  id: string;
  workspace_id: string;
  page_id: string;
  storage_path: string;
  mime_type: string;
  bytes: number;
  uploaded_by: string | null;
  created_at: string;
  storage_backend: "supabase" | "drive";
  drive_connection_id: string | null;
  drive_file_id: string | null;
};

const CONNECTION_COLUMNS = "id, workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted, status, active";
export const ATTACHMENT_COLUMNS =
  "id, workspace_id, page_id, storage_path, mime_type, bytes, uploaded_by, created_at, storage_backend, drive_connection_id, drive_file_id";

export async function activeConnection(admin: SupabaseClient, workspaceId: string): Promise<DriveConnection | null> {
  const { data } = await admin
    .from("drive_connections")
    .select(CONNECTION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .maybeSingle();
  return (data as DriveConnection | null) ?? null;
}

// A wiki Drive, or a personal or project Drive of task files (drive_accounts).
export async function connectionById(admin: SupabaseClient, id: string): Promise<DriveConnection | null> {
  const { data } = await admin.from("drive_connections").select(CONNECTION_COLUMNS).eq("id", id).maybeSingle();
  if (data) return data as DriveConnection;
  const { data: account } = await admin.from("drive_accounts").select(ACCOUNT_COLUMNS).eq("id", id).maybeSingle();
  return account ? accountAsConnection(account as DriveAccount) : null;
}

export type DriveAccount = Omit<DriveConnection, "backups_folder_id"> & { purpose: "personal" | "project"; user_id: string | null; project_id: string | null };
export const ACCOUNT_COLUMNS = "id, workspace_id, purpose, user_id, project_id, account_email, root_folder_id, files_folder_id, token_encrypted, status, active";
export const accountAsConnection = (account: DriveAccount): DriveConnection => ({ ...account, backups_folder_id: account.files_folder_id });

export const refreshTokenOf = (connection: DriveConnection) => decrypt(connection.token_encrypted);

// A revoked or deleted Drive account: shown to the owner in the settings.
export async function noteDriveError(admin: SupabaseClient, connection: DriveConnection, error: unknown) {
  if (error instanceof DriveError && error.revoked) {
    await admin.from("drive_connections").update({ status: "error", last_error: "access_revoked" }).eq("id", connection.id);
    await admin.from("drive_accounts").update({ status: "error", last_error: "access_revoked" }).eq("id", connection.id);
  }
}

// Drive file names: readable, unique per file.
export const driveFileName = (row: Pick<AttachmentRow, "storage_path">) => row.storage_path.split("/").pop() ?? row.storage_path;

export async function readAttachment(admin: SupabaseClient, row: AttachmentRow): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (row.storage_backend === "drive" && row.drive_file_id && row.drive_connection_id) {
    const connection = await connectionById(admin, row.drive_connection_id);
    if (!connection) throw new DriveError("connection gone", 404);
    try {
      return await driveApi().download(refreshTokenOf(connection), row.drive_file_id);
    } catch (error) {
      await noteDriveError(admin, connection, error);
      throw error;
    }
  }
  const { data, error } = await admin.storage.from("attachments").download(row.storage_path);
  if (error || !data) throw new DriveError("storage download failed", 404);
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: row.mime_type };
}

// `rows` is where the attachment record lives: the central database, or a team
// database (path C) reached with its secret key.
export async function putOnDrive(
  admin: SupabaseClient,
  row: AttachmentRow,
  connection: DriveConnection,
  bytes: Uint8Array,
  rows: SupabaseClient = admin,
) {
  let fileId: string;
  try {
    fileId = await driveApi().upload(refreshTokenOf(connection), connection.files_folder_id, driveFileName(row), row.mime_type, bytes);
  } catch (error) {
    await noteDriveError(admin, connection, error);
    throw error;
  }
  const { error } = await rows
    .from("attachments")
    .update({ storage_backend: "drive", drive_connection_id: connection.id, drive_file_id: fileId })
    .eq("id", row.id);
  if (error) throw new Error("attachment update failed");
  return fileId;
}

// Copies a file to the active Drive, then frees its Supabase space. A copy on a
// previously connected Drive is left in place: that Drive belongs to the team.
export async function moveAttachment(admin: SupabaseClient, row: AttachmentRow, connection: DriveConnection) {
  const { bytes } = await readAttachment(admin, row);
  await putOnDrive(admin, row, connection, bytes);
  if (row.storage_backend === "supabase") await admin.storage.from("attachments").remove([row.storage_path]);
}
