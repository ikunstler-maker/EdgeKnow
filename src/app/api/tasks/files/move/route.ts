import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/drive/owner";
import { moveTaskFilesHome } from "@/lib/drive/workspace-files";
import { createAdminClient } from "@/lib/supabase/admin";

// Settings → Storage: moves task files into the workspace's one storage, a
// batch per call (the page calls again until nothing is left). Owner only.
export async function POST(request: NextRequest) {
  const { workspaceId } = (await request.json().catch(() => ({}))) as { workspaceId?: string };
  const owner = await requireOwner(String(workspaceId ?? ""));
  const admin = createAdminClient();
  if (!owner || !admin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  // Not while the workspace is moving into or out of its team's own database (path C).
  const { data: team } = await admin.from("team_databases").select("setup_step, return_step").eq("workspace_id", String(workspaceId)).maybeSingle();
  if (team && ((team.setup_step !== null && team.setup_step !== "done") || team.return_step)) return NextResponse.json({ ok: false, error: "team_setup" }, { status: 409 });
  const result = await moveTaskFilesHome(admin, String(workspaceId));
  if (!result) return NextResponse.json({ ok: false, error: "drive_unavailable" }, { status: 409 });
  if (result.moved && !result.remaining) {
    await admin.from("audit_log").insert({ workspace_id: String(workspaceId), actor_id: owner.userId, action: "task_files_moved", details: { moved: result.moved } });
  }
  return NextResponse.json({ ok: true, ...result });
}
