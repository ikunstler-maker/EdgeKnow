import { mintTeamToken, oidcConfigured, oidcIssuer } from "@/lib/oidc";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A short-lived token for the signed-in person, to use with their team's own
// Supabase project. With a workspace, only for its active members.
export async function POST(request: Request) {
  if (!oidcConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  // RLS returns the profile only for an allowed, verified account.
  const { data: user } = userId
    ? await supabase.from("profiles").select("id, email").eq("id", userId).maybeSingle()
    : { data: null };
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "team_token")) return tooManyRequests();
  const body = (await request.json().catch(() => ({}))) as { workspace?: unknown };
  const workspace = typeof body.workspace === "string" ? body.workspace : undefined;
  if (workspace !== undefined) {
    if (!UUID.test(workspace)) return Response.json({ error: "invalid" }, { status: 400 });
    const { data: member } = await supabase.rpc("is_workspace_member", { ws: workspace });
    if (member !== true) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const minted = await mintTeamToken(oidcIssuer(new URL(request.url).origin), user, workspace);
  return Response.json(minted, { headers: { "Cache-Control": "no-store" } });
}
