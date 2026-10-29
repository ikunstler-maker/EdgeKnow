import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/drive/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";
import { managementToken, SETUP_COLUMNS, type SetupRow } from "./connect";
import { supabaseApi } from "./supabase-api";

// How a team's database is doing (path C, step 1.5b). Checked daily, from the
// settings, and whenever the wiki couldn't reach it. A free Supabase project
// falls asleep after a week without use: the wiki wakes it up itself when it was
// connected through Supabase (the wizard), and tells the team otherwise.

export type Health = "ok" | "waking" | "unreachable" | "revoked" | "almost_full" | "full";
export type HealthReport = { health: Health; databaseBytes: number | null; storageBytes: number | null };

// Supabase's free plan; a paid plan has more, so this only ever warns early.
export const FREE_DATABASE_BYTES = 500 * 1024 * 1024;
export const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
const ALMOST = 0.8;
const FULL = 0.95;

function fullness(database: number, storage: number): Health {
  const share = Math.max(database / FREE_DATABASE_BYTES, storage / FREE_STORAGE_BYTES);
  return share >= FULL ? "full" : share >= ALMOST ? "almost_full" : "ok";
}

// Asleep or still waking up: ask Supabase, and wake it if it sleeps.
async function wakeUp(admin: SupabaseClient, row: SetupRow): Promise<Health> {
  if (!row.management_token_encrypted || !row.project_ref) return "unreachable";
  try {
    const api = supabaseApi(await managementToken(admin, row));
    const project = await api.project(row.project_ref);
    if (project.status === "ACTIVE_HEALTHY") return "unreachable";
    if (project.status === "INACTIVE" || project.status === "PAUSED") await api.restore(row.project_ref);
    return "waking";
  } catch {
    return "unreachable";
  }
}

export async function checkTeamHealth(admin: SupabaseClient, row: SetupRow): Promise<HealthReport> {
  let report: HealthReport = { health: "unreachable", databaseBytes: null, storageBytes: null };
  if (row.project_url && row.secret_key_encrypted) {
    const key = decrypt(row.secret_key_encrypted);
    const response = await fetch(`${row.project_url}/rest/v1/rpc/edgeknow_database_size`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    }).catch(() => null);
    if (response?.ok) {
      const size = (await response.json().catch(() => ({}))) as { database_bytes?: number; storage_bytes?: number };
      const databaseBytes = Number(size.database_bytes ?? 0);
      const storageBytes = Number(size.storage_bytes ?? 0);
      report = { health: fullness(databaseBytes, storageBytes), databaseBytes, storageBytes };
    } else if (response && (response.status === 401 || response.status === 403)) {
      report.health = "revoked";
    } else if (response?.status === 404) {
      // An older schema without the size function (it comes with the next upgrade): reachable at least.
      report.health = "ok";
    } else {
      report.health = await wakeUp(admin, row);
    }
  }
  await admin
    .from("team_databases")
    .update({
      health: report.health,
      health_checked_at: new Date().toISOString(),
      ...(report.databaseBytes === null ? {} : { database_bytes: report.databaseBytes, storage_bytes: report.storageBytes }),
    })
    .eq("workspace_id", row.workspace_id);
  return report;
}

export async function checkWorkspaceHealth(workspaceId: string): Promise<HealthReport | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("team_databases").select(SETUP_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  const row = data as SetupRow | null;
  if (!row || (row.setup_step !== null && row.setup_step !== "done")) return null;
  return checkTeamHealth(admin, row);
}

// The daily round over every connected team database.
export async function checkAllTeams(admin: SupabaseClient) {
  const { data } = await admin.from("team_databases").select(SETUP_COLUMNS).or("setup_step.is.null,setup_step.eq.done");
  const counts: Partial<Record<Health, number>> = {};
  for (const row of (data ?? []) as SetupRow[]) {
    const { health } = await checkTeamHealth(admin, row).catch(() => ({ health: "unreachable" as Health }));
    counts[health] = (counts[health] ?? 0) + 1;
  }
  return counts;
}
