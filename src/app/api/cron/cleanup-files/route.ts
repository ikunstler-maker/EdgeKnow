import { NextResponse, type NextRequest } from "next/server";
import { driveApi } from "@/lib/drive/google-drive";
import { connectionById, refreshTokenOf } from "@/lib/drive/storage";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily (vercel.json): deletes files whose attachment record is gone — removed
// from their page, page deleted forever, or workspace deleted — from Supabase
// Storage or from the workspace's Google Drive. Needs two Vercel environment
// variables: CRON_SECRET (Vercel sends it as a bearer token) and
// SUPABASE_SECRET_KEY (server-only; never exposed to the browser).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const admin = createAdminClient();
  if (!cronSecret || !admin) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: tombstones, error } = await admin
    .from("attachment_tombstones")
    .select("storage_path, storage_backend, drive_connection_id, drive_file_id")
    .order("created_at")
    .limit(500);
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if (!tombstones.length) return NextResponse.json({ removed: 0 });

  const done: string[] = [];
  const onSupabase = tombstones.filter((row) => row.storage_backend !== "drive").map((row) => row.storage_path as string);
  if (onSupabase.length) {
    const removed = await admin.storage.from("attachments").remove(onSupabase);
    if (!removed.error) done.push(...onSupabase);
  }
  for (const row of tombstones.filter((r) => r.storage_backend === "drive")) {
    const connection = row.drive_connection_id ? await connectionById(admin, row.drive_connection_id as string) : null;
    try {
      // A Drive that was disconnected or deleted: nothing left to remove from here.
      if (connection && row.drive_file_id) await driveApi().remove(refreshTokenOf(connection), row.drive_file_id as string);
      done.push(row.storage_path as string);
    } catch {
      // Kept for the next run.
    }
  }
  if (done.length) await admin.from("attachment_tombstones").delete().in("storage_path", done);
  return NextResponse.json({ removed: done.length });
}
