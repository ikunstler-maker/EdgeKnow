import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { mintTeamToken, oidcConfigured, oidcIssuer } from "@/lib/oidc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { WORKSPACE_HEADER } from "./header";
import { latestTeamMigration, upgradeTeam } from "./connect";
import { syncTeam, teamDatabase, teamReady, type TeamDatabase } from "./sync";

// Where a workspace's pages, access and comments live: the central database, or
// (path C) the team's own Supabase project. Server code asks this instead of
// using the central client directly for workspace data.
//
// For a team database the server signs a short-lived token for the signed-in
// member and talks to the team's project with it, so the team's own rules (RLS)
// decide what this person may do — exactly as in the central database.

const SYNC_EVERY_MS = 60_000;

// "setup": the team's project is being connected (step 1.5) and the workspace's
// existing data copied into it (1.7b). Reads stay central and writes are refused
// until it is ready. "returning": the other way (1.7c); reads come from the team
// database and writes are refused until the workspace is central again.
export type WorkspaceData = {
  client: SupabaseClient;
  workspaceId: string;
  location: "central" | "team" | "setup" | "returning";
  // How the team database was at its last check (team workspaces only).
  health?: TeamDatabase["health"];
};

async function requestOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

// The workspace of this request: given explicitly, or the one the proxy found in
// the page address (server actions are posted to the page they run on).
async function shortIdOfRequest(shortId?: string) {
  return shortId ?? (await headers()).get(WORKSPACE_HEADER) ?? null;
}

export const workspaceData = cache(async (shortId?: string): Promise<WorkspaceData | null> => {
  const id = await shortIdOfRequest(shortId);
  const central = await createClient();
  if (!id) return null;
  // Membership is always checked centrally first.
  const workspace = await getWorkspace(id);
  if (!workspace) return null;

  const admin = createAdminClient();
  const db = admin ? await teamDatabase(admin, workspace.id) : null;
  if (db && !oidcConfigured()) throw new Error("team database registered but EDGEKNOW_OIDC_SIGNING_KEYS is not set");
  // Once a workspace has a team database, its data is never read or written centrally.
  if (!db) return { client: central, workspaceId: workspace.id, location: "central" };
  if (!teamReady(db)) return { client: central, workspaceId: workspace.id, location: "setup" };

  // A newer wiki may need a newer team schema; failures leave the old one working.
  if (db.schema_version !== latestTeamMigration()) await upgradeTeam(admin!, workspace.id).catch(() => {});

  const user = await getCurrentUser();
  const issuer = oidcIssuer(await requestOrigin());
  // Keep the team's copy of the members fresh (and at once for someone new).
  const [{ data: synced }, { data: me }] = await Promise.all([
    admin!.from("team_databases").select("last_synced_at").eq("workspace_id", workspace.id).maybeSingle(),
    central.from("workspace_members").select("joined_at").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
  ]);
  const lastSync = synced?.last_synced_at ? Date.parse(synced.last_synced_at) : 0;
  const joinedSince = me?.joined_at ? Date.parse(me.joined_at) >= lastSync : true;
  if (joinedSince || Date.now() - lastSync > SYNC_EVERY_MS) await syncTeam(admin!, db, issuer).catch(() => {});

  const { token } = await mintTeamToken(issuer, user, workspace.id);
  const client = createSupabaseClient(db.project_url!, db.publishable_key!, {
    accessToken: async () => token,
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return { client, workspaceId: workspace.id, location: db.return_step ? "returning" : "team", health: db.health };
});

// For code that only has a page or thread id: the request's workspace, or the central database.
export async function dataClient(shortId?: string): Promise<SupabaseClient> {
  return (await workspaceData(shortId))?.client ?? (await createClient());
}

// For changes: null while the team's project is still being connected.
export async function writeClient(shortId?: string): Promise<SupabaseClient | null> {
  const data = await workspaceData(shortId);
  if (data?.location === "setup" || data?.location === "returning") return null;
  return data?.client ?? (await createClient());
}

// After a membership change centrally (roles, domains, removal, owner, profile
// visibility): copy it to the team database right away.
export async function syncWorkspaceNow(workspaceId: string) {
  const admin = createAdminClient();
  if (!admin || !oidcConfigured()) return;
  const db = await teamDatabase(admin, workspaceId);
  if (!db || !teamReady(db)) return;
  // A new role (e.g. guests) needs the team's schema to know it first.
  if (db.schema_version !== latestTeamMigration()) await upgradeTeam(admin, workspaceId).catch(() => {});
  await syncTeam(admin, db, oidcIssuer(await requestOrigin())).catch(() => {});
}
