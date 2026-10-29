import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/drive/secret-box";

// The central side of a team database (path C): where it is, bringing its
// schema up to date, and copying the workspace and its members into it.
// Everything here runs on the server with the secret key.

// Address and keys are missing only while a connection is being set up (step 1.5).
export type TeamDatabase = {
  workspace_id: string;
  project_url: string | null;
  publishable_key: string | null;
  secret_key_encrypted: string | null;
  db_url_encrypted: string | null;
  schema_version: string | null;
  status: "pending" | "ok" | "error";
  setup_step: "project" | "schema" | "keys" | "sync" | "copy" | "verify" | "sign_in" | "done" | null;
};

const COLUMNS = "workspace_id, project_url, publishable_key, secret_key_encrypted, db_url_encrypted, schema_version, status, setup_step";

export const teamReady = (db: TeamDatabase) =>
  Boolean(db.project_url && db.publishable_key && db.secret_key_encrypted) && (db.setup_step === null || db.setup_step === "done");

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
  if (!db.project_url || !db.secret_key_encrypted) throw new Error("team database not ready");
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
