import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { driveApi, driveConfigured } from "@/lib/drive/google-drive";
import { requireOwner } from "@/lib/drive/owner";
import { sign } from "@/lib/drive/secret-box";
import { mayConnectTaskDrive, safeBack } from "@/lib/drive/task-drive-access";

// Step 1 of connecting Google Drive (workspace owner only): off to Google's
// consent screen with a signed, short-lived "state" naming the workspace and person.
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  if (!driveConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  // Task files: a person's own Drive, or a project's Drive (step "files in tasks").
  const purpose = request.nextUrl.searchParams.get("purpose");
  if (purpose === "personal" || purpose === "project") {
    const project = request.nextUrl.searchParams.get("project");
    const allowed = await mayConnectTaskDrive(ws, purpose, project);
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const back = safeBack(request.nextUrl.searchParams.get("back"));
    const state = sign({ ws, u: allowed.userId, purpose, project, back, exp: Date.now() + 10 * 60 * 1000, n: randomUUID() });
    return NextResponse.redirect(driveApi().authUrl(`${request.nextUrl.origin}/api/drive/callback`, state));
  }
  const owner = await requireOwner(ws);
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const state = sign({ ws, u: owner.userId, exp: Date.now() + 10 * 60 * 1000, n: randomUUID() });
  return NextResponse.redirect(driveApi().authUrl(`${request.nextUrl.origin}/api/drive/callback`, state));
}
