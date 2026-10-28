import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/drive/secret-box";
import { loadTeamMigrations, migrateTeams, postgresExecutor, type TeamMigrationResult } from "./migrate";

// The central side of a team database (path C): where it is, bringing its
// schema up to date, and copying the workspace and its members into it.
// Everything here runs on the server with the secret key.

export type TeamDatabase = {
  workspace_id: string;
  project_url: string;
  publishable_key: string;
  secret_key_encrypted: string;
  db_url_encrypted: string | null;
  schema_version: string | null;
  status: "pending" | "ok" | "error";
};

const COLUMNS = "workspace_id, project_url, publishable_key, secret_key_encrypted, db_url_encrypted, schema_version, status";

export async function teamDatabase(admin: SupabaseClient, workspaceId: string): Promise<TeamDatabase | null> {
  const { data } = await admin.from("team_databases").select(COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  return (data as TeamDatabase | null) ?? null;
}

async function record(admin: SupabaseClient, workspaceId: string, values: Record<string, unknown>) {
  await admin.from("team_databases").update(values).eq("workspace_id", workspaceId);
}

// Copies the workspace, its effective members and their names into the team database.
export async function syncTeam(admin: SupabaseClient, db: TeamDatabase, issuer: string) {
  const { data: payload, error } = await admin.rpc("team_sync_payload", { ws: db.workspace_id });
  if (error || !payload) throw new Error("sync payload unavailable");
  const secretKey = decrypt(db.secret_key_encrypted);
  const send = () =>
    fetch(`${db.project_url}/rest/v1/rpc/team_sync`, {
      method: "POST",
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { ...payload, settings: { ...payload.settings, issuer } } }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  let response = await send();
  // Right after a migration the team's API may still be reloading its schema.
  for (let i = 0; i < 5 && response.status === 404; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    response = await send();
  }
  const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !result?.ok) {
    const message = `sync failed: HTTP ${response.status} ${result?.error ?? ""}`.trim();
    await record(admin, db.workspace_id, { status: "error", last_error: message });
    throw new Error(message);
  }
  await record(admin, db.workspace_id, { status: "ok", last_error: null, last_synced_at: new Date().toISOString() });
}

// Brings every registered team database to the current schema; one failing
// doesn't stop the others.
export async function migrateAllTeams(admin: SupabaseClient): Promise<TeamMigrationResult[]> {
  const { data } = await admin.from("team_databases").select(COLUMNS).not("db_url_encrypted", "is", null);
  const migrations = loadTeamMigrations();
  const latest = migrations.at(-1)?.name ?? null;
  const rows = (data ?? []) as TeamDatabase[];
  const results = await migrateTeams(
    rows.map((db) => ({ team: db.workspace_id, executor: () => postgresExecutor(decrypt(db.db_url_encrypted!)) })),
    migrations,
  );
  for (const result of results) {
    await record(
      admin,
      result.team,
      result.error ? { status: "error", last_error: result.error } : { schema_version: latest, last_error: null },
    );
  }
  return results;
}
