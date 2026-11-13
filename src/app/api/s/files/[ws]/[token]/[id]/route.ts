import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OBJECT_FILE_COLUMNS, filesHome, readTaskFile, type StoredFile } from "@/lib/drive/task-files";

// A picture of a deck shown through its link (KADRY-1): only a picture of that very deck,
// only while its link is on. Shown, never offered as a download; nothing in it can run here.
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/s/files/[ws]/[token]/[id]">) {
  const { ws, token, id } = await params;
  const admin = createAdminClient();
  if (!admin || !/^[a-z0-9]{4,16}$/.test(ws) || !/^[0-9a-f]{32}$/.test(token) || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 });
  const { data: workspace } = await admin.from("workspaces").select("id").eq("short_id", ws).maybeSingle();
  if (!workspace) return new NextResponse(null, { status: 404 });
  try {
    const { rows } = await filesHome(admin, workspace.id);
    const { data: deck } = await rows.rpc("public_deck", { token });
    const deckId = (deck as { ok?: boolean; id?: string } | null)?.ok ? (deck as { id: string }).id : null;
    if (!deckId) return new NextResponse(null, { status: 404 });
    const { data } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", id).eq("object_id", deckId).maybeSingle();
    const row = data as StoredFile | null;
    if (!row) return new NextResponse(null, { status: 404 });
    const bytes = await readTaskFile(admin, rows, row);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mime_type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
