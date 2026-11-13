import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleReady } from "@/lib/calendar-google";
import { sign } from "@/lib/drive/secret-box";
import { authUrl } from "@/lib/google-calendar";
import { getWorkspace } from "@/lib/workspace";

// DOBA-1, step 1 of connecting one's own calendar by signing in with the provider (any
// member but a guest, for themselves): off to the consent screen with a signed,
// short-lived "state" naming the workspace and the person.
export async function GET(request: NextRequest) {
  const shortId = request.nextUrl.searchParams.get("ws") ?? "";
  const timeZone = request.nextUrl.searchParams.get("tz") ?? "";
  if (!googleReady()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const workspace = /^[a-z0-9]{8}$/.test(shortId) ? await getWorkspace(shortId) : null;
  if (!workspace || workspace.role === "guest") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const user = await getCurrentUser();
  const state = sign({
    k: "calendar",
    ws: workspace.id,
    s: workspace.shortId,
    u: user.id,
    tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(timeZone) ? timeZone : "UTC",
    exp: Date.now() + 10 * 60 * 1000,
    n: randomUUID(),
  });
  return NextResponse.redirect(authUrl(`${request.nextUrl.origin}/api/calendar-google/callback`, state));
}
