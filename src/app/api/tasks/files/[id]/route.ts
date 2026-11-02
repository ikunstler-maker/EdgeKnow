import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";
import { TASK_FILE_COLUMNS, filesHome, readTaskFile, showsInline, type TaskFileRow } from "@/lib/drive/task-files";

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
    const bytes = await readTaskFile(admin, rows, row);
    const inline = showsInline(row.mime_type) && request.nextUrl.searchParams.get("download") === null;
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
