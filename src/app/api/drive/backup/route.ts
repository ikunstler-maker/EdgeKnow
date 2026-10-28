import { NextResponse, type NextRequest } from "next/server";
import { backupWorkspace, snapshotWorkspace } from "@/lib/drive/backup";
import { requireOwner } from "@/lib/drive/owner";
import { activeConnection } from "@/lib/drive/storage";
import { createAdminClient } from "@/lib/supabase/admin";

// "Back up now" from the settings (owner); the daily job does the same for everyone.
export async function POST(request: NextRequest) {
  const { workspaceId } = (await request.json().catch(() => ({}))) as { workspaceId?: string };
  const owner = await requireOwner(String(workspaceId ?? ""));
  const admin = createAdminClient();
  if (!owner || !admin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const connection = await activeConnection(admin, String(workspaceId));
  if (!connection || connection.status !== "ok") return NextResponse.json({ ok: false, error: "drive_unavailable" }, { status: 409 });
  try {
    const pages = await backupWorkspace(admin, connection);
    const snapshot = await snapshotWorkspace(admin, connection);
    return NextResponse.json({ ok: true, ...pages, snapshot: snapshot.saved });
  } catch {
    return NextResponse.json({ ok: false, error: "drive_failed" }, { status: 502 });
  }
}
