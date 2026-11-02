import { NextResponse, type NextRequest } from "next/server";
import { memberFilesZip } from "@/lib/drive/member-files";
import { workspaceAdminFor } from "@/lib/drive/member-access";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// A person's task files from their own Google Drive, as one ZIP archive to
// download (?ws=<workspace id>&user=<id>). Owner and admins of the workspace only.
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  const member = request.nextUrl.searchParams.get("user") ?? "";
  const access = await workspaceAdminFor(ws, member);
  if (!access) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (await overLimit(await createClient(), "export")) return tooManyRequests();
  const { data: person } = await access.admin.from("profiles").select("email").eq("id", member).maybeSingle();
  await access.admin.from("audit_log").insert({ workspace_id: ws, actor_id: access.actor, action: "member_files_downloaded", details: { member } });
  const name = `edgeknow-files-${(person?.email ?? member).replace(/[^a-zA-Z0-9._-]/g, "_")}.zip`;
  return new NextResponse(await memberFilesZip(access.admin, ws, member), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
