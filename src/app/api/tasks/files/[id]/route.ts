import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dataClient } from "@/lib/team-db/data";
import { STREAM_FROM_BYTES, TASK_FILE_COLUMNS, filesHome, readTaskFile, showsInline, streamTaskFile, type TaskFileRow } from "@/lib/drive/task-files";

// A task's file (?ws=<short id>). The record is read with the person's own
// session, so RLS decides: no access to the task, no file. The bytes come
// through our server; nothing is ever shared from the Drive itself.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/tasks/files/[id]">) {
  const { id } = await params;
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9]{4,16}$/.test(ws)) return new NextResponse(null, { status: 404 });
  const db = await dataClient(ws);
  const { data } = await db.from("task_files").select(TASK_FILE_COLUMNS).eq("id", id).maybeSingle();
  const row = data as TaskFileRow | null;
  const admin = createAdminClient();
  if (!row || !admin) return new NextResponse(null, { status: 404 });
  try {
    const { rows } = await filesHome(admin, row.workspace_id);
    // A guest gets files shown, not handed over as downloads (where the browser can show them).
    const { data: claims } = await (await createClient()).auth.getClaims();
    const { data: me } = await db.from("workspace_members").select("role").eq("workspace_id", row.workspace_id).eq("user_id", String(claims?.claims?.sub ?? "")).maybeSingle();
    const asDownload = request.nextUrl.searchParams.get("download") !== null && me?.role !== "guest";
    const inline = showsInline(row.mime_type) && !asDownload;
    const headers = {
      "Content-Type": row.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "Cache-Control": "private, max-age=3600",
    };
    // A large file (one that came from another tracker) is passed on as it arrives from
    // the Drive, part by part; the browser may ask for a part of it and continue later.
    if (Number(row.bytes) > STREAM_FROM_BYTES) {
      const stream = await streamTaskFile(admin, row, request.headers.get("range"));
      return new NextResponse(stream.body, { status: stream.status === 206 ? 206 : 200, headers: { ...headers, ...stream.headers } });
    }
    const bytes = await readTaskFile(admin, rows, row);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mime_type,
        "X-Content-Type-Options": "nosniff",
        // Nothing in a file can run on our site.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
