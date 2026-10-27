import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Daily (vercel.json): deletes files whose attachment record is gone — removed
// from their page, page deleted forever, or workspace deleted. Needs two Vercel
// environment variables: CRON_SECRET (Vercel sends it as a bearer token) and
// SUPABASE_SECRET_KEY (server-only; never exposed to the browser).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!cronSecret || !secretKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tombstones, error } = await admin
    .from("attachment_tombstones")
    .select("storage_path")
    .order("created_at")
    .limit(500);
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if (!tombstones.length) return NextResponse.json({ removed: 0 });

  const paths = tombstones.map((row) => row.storage_path as string);
  const removed = await admin.storage.from("attachments").remove(paths);
  if (removed.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  await admin.from("attachment_tombstones").delete().in("storage_path", paths);
  return NextResponse.json({ removed: paths.length });
}
