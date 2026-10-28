import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/drive/owner";
import { verify } from "@/lib/drive/secret-box";
import { workspacePath } from "@/lib/paths";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveConnectSession } from "@/lib/team-db/connect-session";
import { exchangeCode, supabaseCallbackUrl, supabaseOAuthConfigured } from "@/lib/team-db/supabase-api";

// Step 2: Supabase sends the owner back with a code. The state must be ours,
// fresh and for the same person, who must still own the workspace; then the
// access waits in an encrypted cookie while they choose the project.
export async function GET(request: NextRequest) {
  const fail = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const jar = await cookies();
  const state = verify<{ ws: string; u: string; exp: number }>(request.nextUrl.searchParams.get("state") ?? "");
  const pkce = verify<{ v: string; ws: string }>(jar.get("ek-sb-pkce")?.value ?? "");
  jar.delete("ek-sb-pkce");
  const code = request.nextUrl.searchParams.get("code");
  if (!supabaseOAuthConfigured() || !state || state.exp < Date.now() || !code || !pkce || pkce.ws !== state.ws) return fail("/");

  const owner = await requireOwner(state.ws);
  const admin = createAdminClient();
  if (!owner || owner.userId !== state.u || !admin) return fail("/");
  const { data: workspace } = await admin.from("workspaces").select("short_id").eq("id", state.ws).maybeSingle();
  if (!workspace) return fail("/");
  const settings = (result: string) => fail(`${workspacePath(workspace.short_id, "/settings")}?tab=team&supabase=${result}`);

  try {
    const tokens = await exchangeCode(code, supabaseCallbackUrl(request.nextUrl.origin), pkce.v);
    await saveConnectSession({ ws: state.ws, u: owner.userId, refreshToken: tokens.refreshToken });
  } catch {
    return settings("error");
  }
  return settings("choose");
}
