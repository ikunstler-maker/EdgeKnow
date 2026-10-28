import { NextResponse, type NextRequest } from "next/server";
import { backupWorkspace } from "@/lib/drive/backup";
import type { DriveConnection } from "@/lib/drive/storage";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily (vercel.json): backs up changed pages of every workspace with a Drive.
// Needs CRON_SECRET (Vercel sends it as a bearer token) and SUPABASE_SECRET_KEY.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { data } = await admin
    .from("drive_connections")
    .select("id, workspace_id, account_email, root_folder_id, files_folder_id, backups_folder_id, token_encrypted, status, active")
    .eq("active", true)
    .eq("status", "ok");
  const results: Record<string, unknown> = {};
  for (const connection of (data ?? []) as DriveConnection[]) {
    try {
      results[connection.workspace_id] = await backupWorkspace(admin, connection, 200);
    } catch {
      results[connection.workspace_id] = { error: "drive_failed" };
    }
  }
  return NextResponse.json({ workspaces: results });
}
