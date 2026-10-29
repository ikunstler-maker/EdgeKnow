import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/drive/owner";
import { ATTACHMENT_COLUMNS, activeConnection, moveAttachment, type AttachmentRow } from "@/lib/drive/storage";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH = 5;

// Moves a few files to the active Drive per call; the settings page calls it
// again until nothing is left, showing the progress.
export async function POST(request: NextRequest) {
  const { workspaceId } = (await request.json().catch(() => ({}))) as { workspaceId?: string };
  const owner = await requireOwner(String(workspaceId ?? ""));
  const admin = createAdminClient();
  if (!owner || !admin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  // Not while the workspace is moving into its team's own database (path C): the copy would go stale.
  const { data: team } = await admin.from("team_databases").select("setup_step").eq("workspace_id", String(workspaceId)).maybeSingle();
  if (team && team.setup_step !== null && team.setup_step !== "done") return NextResponse.json({ ok: false, error: "team_setup" }, { status: 409 });
  const connection = await activeConnection(admin, String(workspaceId));
  if (!connection || connection.status !== "ok") return NextResponse.json({ ok: false, error: "drive_unavailable" }, { status: 409 });

  const pending = () =>
    admin
      .from("attachments")
      .select(ATTACHMENT_COLUMNS, { count: "exact" })
      .eq("workspace_id", connection.workspace_id)
      .or(`storage_backend.eq.supabase,drive_connection_id.neq.${connection.id},drive_connection_id.is.null`)
      .order("created_at")
      .limit(BATCH);

  const { data } = await pending();
  let moved = 0;
  let failed = 0;
  for (const row of (data ?? []) as AttachmentRow[]) {
    try {
      await moveAttachment(admin, row, connection);
      moved += 1;
    } catch {
      failed += 1;
    }
  }
  const { count } = await pending();
  if (moved && !count) {
    await admin.from("audit_log").insert({ workspace_id: connection.workspace_id, actor_id: owner.userId, action: "files_moved_to_drive", details: {} });
  }
  return NextResponse.json({ ok: true, moved, failed, remaining: count ?? 0 });
}
