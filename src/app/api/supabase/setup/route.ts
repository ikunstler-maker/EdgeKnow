import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/drive/owner";
import { encrypt } from "@/lib/drive/secret-box";
import { oidcConfigured, oidcIssuer } from "@/lib/oidc";
import { createAdminClient } from "@/lib/supabase/admin";
import { advanceSetup, SETUP_COLUMNS, type SetupRow } from "@/lib/team-db/connect";
import { clearConnectSession, readConnectSession, saveConnectSession } from "@/lib/team-db/connect-session";
import { refreshTokens, supabaseApi } from "@/lib/team-db/supabase-api";

// Step 3 of connecting the team's own Supabase (owner only):
//   { action: "create", organization, region } — a new project in their organization;
//   { action: "existing", ref } — an empty project they already have;
//   { action: "advance" } — the next setup step (the page asks every few seconds);
//   { action: "options" } — the owner's organizations and projects to choose from.
export const maxDuration = 60;

const REGIONS = new Set(["eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "us-east-1", "us-west-1", "ap-southeast-1"]);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = typeof body.ws === "string" ? body.ws : "";
  const owner = await requireOwner(ws);
  const admin = createAdminClient();
  if (!owner || !admin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!oidcConfigured()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const issuer = oidcIssuer(request.nextUrl.origin);
  const { data: existing } = await admin.from("team_databases").select(SETUP_COLUMNS).eq("workspace_id", ws).maybeSingle();

  if (body.action === "advance") {
    if (!existing) return NextResponse.json({ ok: false, error: "not_started" }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await advanceSetup(admin, existing as SetupRow, issuer)) });
  }

  // Starting: only for a workspace whose data isn't anywhere yet (moving existing
  // pages is step 1.7).
  if (existing) return NextResponse.json({ ok: false, error: "already_connected" }, { status: 409 });
  const { count } = await admin.from("pages").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  if (count) return NextResponse.json({ ok: false, error: "has_pages" }, { status: 409 });
  const session = await readConnectSession(ws, owner.userId);
  if (!session) return NextResponse.json({ ok: false, error: "session_expired" }, { status: 401 });

  try {
    const tokens = await refreshTokens(session.refreshToken);
    const api = supabaseApi(tokens.accessToken);
    if (body.action === "options") {
      // Supabase hands out a new refresh token each time: keep it for the next call.
      await saveConnectSession({ ws, u: owner.userId, refreshToken: tokens.refreshToken });
      const [organizations, projects] = await Promise.all([api.organizations(), api.projects()]);
      return NextResponse.json({
        ok: true,
        organizations: organizations.map((o) => ({ slug: o.slug, name: o.name })),
        projects: projects.map((p) => ({ ref: p.ref, name: p.name, region: p.region, status: p.status })),
      });
    }
    let ref: string;
    if (body.action === "create") {
      const organization = String(body.organization ?? "");
      const region = REGIONS.has(String(body.region)) ? String(body.region) : "eu-central-1";
      const { data: workspace } = await admin.from("workspaces").select("short_id").eq("id", ws).single();
      const project = await api.createProject({
        name: `edgeknow-${workspace?.short_id ?? "team"}`,
        organizationSlug: organization,
        region,
        // Nobody needs it: the wiki works through the Management API and the keys.
        dbPass: randomBytes(24).toString("base64url"),
      });
      ref = project.ref;
    } else if (body.action === "existing") {
      ref = String(body.ref ?? "");
      if (!/^[a-z0-9]{20}$/.test(ref)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
      // Only an empty project: the wiki never mixes its tables with someone else's.
      const [{ tables }] = await api.query<{ tables: number }>(
        ref,
        "select count(*)::int as tables from pg_tables where schemaname = 'public' and tablename <> 'edgeknow_migrations'",
      );
      if (tables > 0) return NextResponse.json({ ok: false, error: "project_not_empty" }, { status: 409 });
    } else {
      return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    }
    const { error } = await admin.from("team_databases").insert({
      workspace_id: ws,
      project_ref: ref,
      management_token_encrypted: encrypt(tokens.refreshToken),
      setup_step: "project",
      status: "pending",
      connected_by: owner.userId,
    });
    if (error) return NextResponse.json({ ok: false, error: "already_connected" }, { status: 409 });
    await admin.from("audit_log").insert({ workspace_id: ws, actor_id: owner.userId, action: "team_database_connected", details: { project: ref } });
    await clearConnectSession();
    return NextResponse.json({ ok: true, step: "project" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "supabase", detail: String((error as Error).message).slice(0, 200) }, { status: 502 });
  }
}
