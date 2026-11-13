import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { driveApi } from "@/lib/drive/google-drive";
import { connectionById, noteDriveError, refreshTokenOf } from "@/lib/drive/storage";
import { chatFileLooksLike, filesHome, workspaceDestination } from "@/lib/drive/task-files";
import { VAULT_PART_BYTES, vaultChecked } from "@/lib/vault-files";

export const maxDuration = 60;

// A Vault file over 4 MB goes in parts: the browser sends parts of 4 MB one after another
// and the server passes each on to the workspace's Google Drive. Nothing large is held in
// memory or kept in EdgeKnow's own storage. Without a Drive a large file can't be added.
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

async function who(ws: string) {
  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  return { central, userId, admin: createAdminClient(), db: userId ? await writeClient(ws) : null };
}

// Start: ?ws=<short id>&folder=<id or empty>&name=<file name>&size=<bytes>&type=<kind>.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const folder = params.get("folder") || null;
  const replace = params.get("replace") || null;
  const name = (params.get("name") ?? "").trim().slice(0, 200);
  const size = Number(params.get("size"));
  const type = (params.get("type") ?? "").trim().toLowerCase().slice(0, 130);
  if (!/^[a-z0-9]{4,16}$/.test(ws) || (folder && !/^[0-9a-f-]{36}$/.test(folder)) || (replace && !/^[0-9a-f-]{36}$/.test(replace)) || !name || !Number.isSafeInteger(size) || size <= VAULT_PART_BYTES) return bad("invalid");
  const { central, userId, admin, db } = await who(ws);
  if (!userId) return bad("unauthorized", 401);
  if (await overLimit(central, "upload")) return tooManyRequests();
  const workspace = await getWorkspace(ws);
  if (!admin || !db || !workspace) return bad("team_setup", 503);
  // Whether the Drive is there is known before anything is recorded.
  const to = await workspaceDestination(admin, workspace.id);
  if ("error" in to || to.kind !== "drive") return bad("error" in to ? to.error : "no_drive", 409);

  const { data: registered } = replace
    ? await db.rpc("begin_vault_version", { target: replace, file_name: name, file_type: type, file_bytes: size })
    : await db.rpc("begin_vault_file", { ws: workspace.id, folder, file_name: name, file_type: type, file_bytes: size });
  const reg = registered as { ok: boolean; error?: string; id?: string; large?: boolean } | null;
  if (!reg?.ok || !reg.id) return bad(reg?.error ?? "unknown", 403);
  const { rows } = await filesHome(admin, workspace.id);
  const forget = () => rows.from("vault_items").delete().eq("id", reg.id!);
  try {
    const { data: row } = await rows.from("vault_items").select("mime_type").eq("id", reg.id).single();
    const session = await driveApi().beginUpload(refreshTokenOf(to.connection), to.connection.files_folder_id, `${reg.id.slice(0, 8)} ${name}`.slice(0, 200), String(row?.mime_type ?? "application/octet-stream"), size);
    const { error } = await rows.from("vault_uploads").insert({ file_id: reg.id, workspace_id: workspace.id, session, account_id: to.connection.id });
    if (error) throw new Error("upload record failed");
  } catch (error) {
    await noteDriveError(admin, to.connection, error);
    await forget();
    return bad("upload_failed", 502);
  }
  return NextResponse.json({ ok: true, id: reg.id, part: VAULT_PART_BYTES });
}

// A part: ?ws=<short id>&id=<file id>&offset=<bytes already sent>, the part as the body.
// Parts come in order; every part but the last is exactly VAULT_PART_BYTES long.
export async function PUT(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const id = params.get("id") ?? "";
  const offset = Number(params.get("offset"));
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(offset) || offset < 0) return bad("invalid");
  const { userId, admin, db } = await who(ws);
  if (!userId) return bad("unauthorized", 401);
  if (!admin || !db) return bad("team_setup", 503);
  // The record is read with the person's own session: only the one who started the upload continues it.
  const { data: mine } = await db.from("vault_items").select("id, workspace_id, bytes, mime_type, owner_id, storage_backend, large, version_of").eq("id", id).maybeSingle();
  const file = mine as { id: string; workspace_id: string; bytes: number; mime_type: string; owner_id: string | null; storage_backend: string; large: boolean; version_of: string | null } | null;
  if (!file || file.owner_id !== userId || file.storage_backend !== "pending" || !file.large) return bad("forbidden", 403);
  const { rows } = await filesHome(admin, file.workspace_id);
  const { data: state } = await rows.from("vault_uploads").select("session, sent, account_id").eq("file_id", id).maybeSingle();
  const upload = state as { session: string; sent: number; account_id: string } | null;
  const connection = upload ? await connectionById(admin, upload.account_id) : null;
  if (!upload || !connection) return bad("upload_failed", 409);
  // A part sent twice (a retry after a lost answer) is not sent to the Drive again.
  if (offset !== Number(upload.sent)) return NextResponse.json({ ok: true, done: false, offset: Number(upload.sent) });
  const size = Number(file.bytes);
  const part = new Uint8Array(await request.arrayBuffer());
  const last = offset + part.length === size;
  if (!part.length || part.length > VAULT_PART_BYTES || offset + part.length > size || (!last && part.length !== VAULT_PART_BYTES)) return bad("invalid");
  // A file that says it is a picture, a PDF or a document must start like one.
  if (offset === 0 && !vaultChecked(file.mime_type, part, chatFileLooksLike)) {
    await rows.from("vault_items").delete().eq("id", id);
    return bad("invalid_file");
  }
  try {
    const { fileId } = await driveApi().sendPart(refreshTokenOf(connection), upload.session, part, offset, size);
    if (!fileId) {
      if (last) throw new Error("upload not finished");
      await rows.from("vault_uploads").update({ sent: offset + part.length }).eq("file_id", id);
      return NextResponse.json({ ok: true, done: false, offset: offset + part.length });
    }
    const { error } = await rows.from("vault_items").update({ storage_backend: "drive", drive_source: "wiki", drive_account_id: connection.id, drive_file_id: fileId }).eq("id", id);
    if (error) throw new Error("record update failed");
    await rows.from("vault_uploads").delete().eq("file_id", id);
    if (file.version_of) {
      // A new version: its bytes now take the file's place.
      const { data: finished } = await db.rpc("vault_finish_version", { upload: id });
      if (!(finished as { ok?: boolean } | null)?.ok) throw new Error("version not put in place");
    }
    return NextResponse.json({ ok: true, done: true, offset: size });
  } catch (error) {
    await noteDriveError(admin, connection, error);
    await rows.from("vault_items").delete().eq("id", id);
    return bad("upload_failed", 502);
  }
}
