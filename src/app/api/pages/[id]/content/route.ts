import { NextResponse, type NextRequest } from "next/server";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeClient } from "@/lib/team-db/data";

// Saves the editor document. Rights, the trash, the size limit and the version
// check are all enforced by public.save_page_content; this route only forwards.
export async function POST(request: NextRequest, { params }: RouteContext<"/api/pages/[id]/content">) {
  const { id } = await params;
  let body: { content?: unknown; baseVersion?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_content" }, { status: 400 });
  }
  if (!Array.isArray(body.content) || typeof body.baseVersion !== "number") {
    return NextResponse.json({ ok: false, error: "invalid_content" }, { status: 400 });
  }

  if (await overLimit(await createClient(), "save")) return tooManyRequests();

  // A page fed by an external source is written only by the server (its next refresh).
  const admin = createAdminClient();
  if (admin) {
    const { data: source } = await admin.from("external_sources").select("id").eq("page_id", id).maybeSingle();
    if (source) return NextResponse.json({ ok: false, error: "external_source" }, { status: 409 });
  }

  // The page's workspace comes from the editor (?w=<short id>); membership is checked there.
  const supabase = await writeClient(request.nextUrl.searchParams.get("w") ?? undefined);
  if (!supabase) return NextResponse.json({ ok: false, error: "team_setup" }, { status: 409 });
  const { data, error } = await supabase.rpc("save_page_content", {
    target_page: id,
    new_content: body.content,
    base_version: body.baseVersion,
    force: body.force === true,
  });
  if (error || !data) {
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
  return NextResponse.json(data);
}
