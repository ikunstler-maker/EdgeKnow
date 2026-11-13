import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { finishConnect, googleReady, pushWorkspace } from "@/lib/calendar-google";
import { verify } from "@/lib/drive/secret-box";
import { workspacePath } from "@/lib/paths";
import { getWorkspace } from "@/lib/workspace";

// DOBA-1, step 2: the provider sends the person back with a code. The state must be ours,
// fresh, for a calendar, for this same person, who must still be a member (not a guest).
export async function GET(request: NextRequest) {
  const home = () => NextResponse.redirect(new URL("/", request.nextUrl.origin));
  const state = verify<{ k: string; ws: string; s: string; u: string; tz: string; exp: number }>(request.nextUrl.searchParams.get("state") ?? "");
  if (!googleReady() || !state || state.k !== "calendar" || state.exp < Date.now()) return home();
  const workspace = await getWorkspace(state.s);
  const user = await getCurrentUser();
  if (!workspace || workspace.id !== state.ws || workspace.role === "guest" || user.id !== state.u) return home();
  const back = (result: string) => NextResponse.redirect(new URL(`${workspacePath(workspace.shortId, "/calendar")}?google=${result}`, request.nextUrl.origin));

  const code = request.nextUrl.searchParams.get("code");
  // The person said no on the consent screen.
  if (!code) return back("cancelled");
  const done = await finishConnect(workspace.id, user.id, code, `${request.nextUrl.origin}/api/calendar-google/callback`, state.tz);
  if (!done.ok) return back(done.error === "permissions" ? "permissions" : "error");
  after(() => pushWorkspace(workspace.id).catch(() => {}));
  return back("connected");
}
