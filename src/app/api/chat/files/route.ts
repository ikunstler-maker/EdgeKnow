import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { writeClient } from "@/lib/team-db/data";
import { MAX_CHAT_FILE_BYTES, chatFileLooksLike, filesHome, storeTaskFile, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";

const CHAT_FILE_COLUMNS =
  "id, workspace_id, channel_id, name, mime_type, bytes, storage_path, storage_backend, drive_source, drive_account_id, drive_file_id, uploaded_by, created_at";

// Adds a file to a chat message being written: ?ws=<short id>&ch=<channel>&name=<file name>
// &kind=file|image|voice[&duration=<ms>][&w=&h=], the bytes as the body with their type.
// The database checks the right to write in the channel, the kind, the size and the
// workspace's limit (register_chat_file, with the person's own session); the server then
// checks the bytes really are of that type and stores them in the workspace's one storage.
// The file is sent later with the message (chat_post_message).
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ws = params.get("ws") ?? "";
  const channel = params.get("ch") ?? "";
  const name = (params.get("name") ?? "").trim().slice(0, 200);
  const kind = params.get("kind") ?? "file";
  const number = (key: string) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  };
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f-]{36}$/.test(channel) || !name || !["file", "image", "voice"].includes(kind)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const central = await createClient();
  const { data: claims } = await central.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(central, "upload")) return tooManyRequests();
  const admin = createAdminClient();
  const db = await writeClient(ws);
  if (!admin || !db) return NextResponse.json({ ok: false, error: "team_setup" }, { status: 503 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_CHAT_FILE_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 400 });
  if (!chatFileLooksLike(type, bytes)) return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });

  const { data: registered } = await db.rpc("register_chat_file", {
    ch: channel,
    file_name: name,
    file_type: type,
    file_bytes: bytes.length,
    file_kind: kind,
    duration: kind === "voice" ? (number("duration") ?? 0) : null,
    file_width: number("w"),
    file_height: number("h"),
  });
  const reg = registered as { ok: boolean; error?: string; id?: string; workspace_id?: string } | null;
  if (!reg?.ok || !reg.id) return NextResponse.json({ ok: false, error: reg?.error ?? "unknown" }, { status: 403 });

  const { rows } = await filesHome(admin, reg.workspace_id!);
  const forget = () => rows.from("chat_files").delete().eq("id", reg.id!);
  const to = await workspaceDestination(admin, reg.workspace_id!);
  if ("error" in to) {
    await forget();
    return NextResponse.json({ ok: false, error: to.error }, { status: 409 });
  }
  const { data: row } = await rows.from("chat_files").select(CHAT_FILE_COLUMNS).eq("id", reg.id).single();
  try {
    await storeTaskFile(admin, rows, row as StoredFile, bytes, to);
  } catch {
    await forget();
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: reg.id });
}
