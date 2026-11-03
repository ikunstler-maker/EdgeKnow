import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";
import { OBJECT_FILE_COLUMNS, filesHome, readTaskFile, type StoredFile } from "@/lib/drive/task-files";

// A board's picture (?ws=<short id>). The record is read with the person's own
// session, so RLS decides: no access to the board, no picture. Shown, never
// offered as a download; nothing in it can run on our site.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/boards/files/[id]">) {
  const { id } = await params;
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9]{4,16}$/.test(ws)) return new NextResponse(null, { status: 404 });
  const db = await dataClient(ws);
  const { data } = await db.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", id).maybeSingle();
  const row = data as StoredFile | null;
  const admin = createAdminClient();
  if (!row || !admin) return new NextResponse(null, { status: 404 });
  try {
    const { rows } = await filesHome(admin, row.workspace_id);
    const bytes = await readTaskFile(admin, rows, row);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mime_type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
