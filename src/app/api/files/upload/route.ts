import { NextResponse, type NextRequest } from "next/server";
import { ATTACHMENT_COLUMNS, activeConnection, putOnDrive, type AttachmentRow } from "@/lib/drive/storage";
import { ATTACHMENT_PATH, looksLike } from "@/lib/drive/file-checks";
import { createAdminClient } from "@/lib/supabase/admin";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { TEAM_BUCKET, teamAdmin, teamDataFor, teamOfPath, teamStorage } from "@/lib/team-db/files";

// Images up to 2 MB; gallery audio up to 4 MB (the most a server request may hold).
const maxBytes = (mimeType: string) => (mimeType.startsWith("audio/") ? 4 : 2) * 1024 * 1024;

// Uploads an already compressed image to the workspace's Google Drive, or for a
// team workspace (path C) to the team's own Supabase Storage. The path must have
// been registered by this same person a moment ago (register_attachment checked
// rights, type, size and the trash); the bytes must match that record.
export async function POST(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!ATTACHMENT_PATH.test(path)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "upload")) return tooManyRequests();

  const team = await teamOfPath(path);
  const rows = team ? await teamDataFor(team.shortId) : supabase;
  const { data } = await rows.from("attachments").select(ATTACHMENT_COLUMNS).eq("storage_path", path).maybeSingle();
  const row = data as AttachmentRow | null;
  const fresh = row && Date.now() - new Date(row.created_at).getTime() < 60 * 60 * 1000;
  if (!row || row.uploaded_by !== userId || row.drive_file_id || row.storage_backend !== "supabase" || !fresh) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes(row.mime_type) || bytes.length !== row.bytes || !looksLike(row.mime_type, bytes)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const connection = admin ? await activeConnection(admin, row.workspace_id) : null;
  // A team workspace without a Drive: the team's own storage.
  if (team && !(connection?.status === "ok")) {
    const { error } = await teamStorage(team.db).storage.from(TEAM_BUCKET).upload(path, bytes, { contentType: row.mime_type, upsert: false });
    return error ? NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 }) : NextResponse.json({ ok: true });
  }
  if (!admin || !connection || connection.status !== "ok") {
    return NextResponse.json({ ok: false, error: "drive_unavailable" }, { status: 503 });
  }
  try {
    await putOnDrive(admin, row, connection, bytes, team ? teamAdmin(team.db) : admin);
  } catch {
    return NextResponse.json({ ok: false, error: "drive_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
