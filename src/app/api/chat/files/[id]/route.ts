import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";
import { CHAT_FILE_COLUMNS, filesHome, readTaskFile, showsInline, type StoredFile } from "@/lib/drive/task-files";

const AUDIO = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"];

// A chat file (?ws=<short id>[&download]). The record is read with the person's own
// session, so the database decides: no access to the message (or the channel), no file.
// The bytes come through our server; nothing is shared from storage or the Drive itself.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/chat/files/[id]">) {
  const { id } = await params;
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9]{4,16}$/.test(ws)) return new NextResponse(null, { status: 404 });
  const db = await dataClient(ws);
  const { data } = await db.from("chat_files").select(CHAT_FILE_COLUMNS).eq("id", id).maybeSingle();
  const row = data as StoredFile | null;
  const admin = createAdminClient();
  if (!row || !admin) return new NextResponse(null, { status: 404 });
  try {
    const { rows } = await filesHome(admin, row.workspace_id);
    const bytes = await readTaskFile(admin, rows, row);
    const inline = (showsInline(row.mime_type) || AUDIO.includes(row.mime_type)) && request.nextUrl.searchParams.get("download") === null;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mime_type,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        // Nothing in a file can run on our site.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
