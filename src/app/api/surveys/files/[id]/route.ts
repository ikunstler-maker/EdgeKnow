import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";
import { OBJECT_FILE_COLUMNS, filesHome, readTaskFile, type StoredFile } from "@/lib/drive/task-files";

// A file from a survey's answers (?ws=<short id>). The record is read with the
// person's own session, so RLS decides: those who see the answers, or whoever
// added it. Always a download; nothing in it can run on our site.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/surveys/files/[id]">) {
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
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
