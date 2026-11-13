import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspace } from "@/lib/workspace";
import { DriveError, GOOGLE_NATIVE, driveApi } from "./google-drive";
import { activeConnection, connectionById, noteDriveError, refreshTokenOf, type DriveConnection } from "./storage";
import { filesHome } from "./task-files";

// VAULT-7: the team's Google Drive inside Vault. Members (never guests) see the Drive
// connected to the workspace while its owner keeps the switch on. Everything goes
// through our server with the connection's access; the Drive's own access never reaches
// the browser.

export type BrowseState =
  | { ok: true; email: string }
  | { ok: false; error: "forbidden" | "off" | "no_drive" | "not_allowed" | "drive_error" };

type Context = { admin: SupabaseClient; workspaceId: string; owner: boolean; connection: DriveConnection | null; state: BrowseState };

// Who may, and whether the Drive can be read now (the owner sees why not, to fix it).
export async function browseContext(shortId: string): Promise<Context | null> {
  const workspace = await getWorkspace(shortId);
  const admin = createAdminClient();
  if (!workspace || !admin) return null;
  const base = { admin, workspaceId: workspace.id, owner: workspace.role === "owner", connection: null };
  if (workspace.role === "guest") return { ...base, state: { ok: false, error: "forbidden" } };
  const { rows } = await filesHome(admin, workspace.id);
  const { data: settings } = await rows.from("vault_settings").select("drive_browse").eq("workspace_id", workspace.id).maybeSingle();
  if (settings && settings.drive_browse === false) return { ...base, state: { ok: false, error: "off" } };
  const connection = await activeConnection(admin, workspace.id);
  if (!connection) return { ...base, state: { ok: false, error: "no_drive" } };
  const { data: browse } = await admin.from("drive_connections").select("can_browse").eq("id", connection.id).maybeSingle();
  if (!browse?.can_browse) return { ...base, connection, state: { ok: false, error: "not_allowed" } };
  if (connection.status !== "ok") return { ...base, connection, state: { ok: false, error: "drive_error" } };
  return { ...base, connection, state: { ok: true, email: connection.account_email } };
}

// Google's own documents have no bytes of their own: they are handed over as a PDF.
const EXPORTED = ["document", "spreadsheet", "presentation", "drawing"].map((kind) => `${GOOGLE_NATIVE}${kind}`);
export const driveOpenable = (mimeType: string) => !mimeType.startsWith(GOOGLE_NATIVE) || EXPORTED.includes(mimeType);

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
  "Cache-Control": "private, no-store",
};

// A Drive file as a download (or, for a picture or a PDF asked to be shown, in place),
// passed on as it arrives; nothing in it can run on our site.
export async function driveFileResponse(
  admin: SupabaseClient,
  connection: DriveConnection,
  fileId: string,
  file: { name: string; mimeType: string },
  show: boolean,
  range: string | null,
): Promise<NextResponse> {
  const native = file.mimeType.startsWith(GOOGLE_NATIVE);
  if (!driveOpenable(file.mimeType)) return new NextResponse(null, { status: 415 });
  const name = native ? `${file.name}.pdf` : file.name;
  const mime = native ? "application/pdf" : file.mimeType;
  const inline = show && ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mime);
  const headers = {
    ...HEADERS,
    "Content-Type": inline ? mime : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  try {
    const token = refreshTokenOf(connection);
    const stream = native ? await driveApi().exportPdf(token, fileId) : await driveApi().stream(token, fileId, range);
    return new NextResponse(stream.body, { status: stream.status === 206 ? 206 : 200, headers: { ...headers, ...stream.headers } });
  } catch (error) {
    if (error instanceof DriveError && error.status === 401) await noteDriveError(admin, connection, error);
    return new NextResponse(null, { status: error instanceof DriveError && error.status === 404 ? 404 : 502 });
  }
}

// A link kept in Vault: its own connection (an earlier Drive stays readable).
export async function linkResponse(admin: SupabaseClient, row: { drive_account_id: string | null; drive_file_id: string | null; name: string; mime_type: string }, show: boolean, range: string | null) {
  const connection = row.drive_account_id ? await connectionById(admin, row.drive_account_id) : null;
  if (!connection || !row.drive_file_id) return new NextResponse(null, { status: 404 });
  return driveFileResponse(admin, connection, row.drive_file_id, { name: row.name, mimeType: row.mime_type }, show, range);
}
