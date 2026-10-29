import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/drive/secret-box";
import { loadTeamMigrations, managementExecutor, migrateTeam, migrateTeams, postgresExecutor, type TeamExecutor, type TeamMigrationResult } from "./migrate";
import { supabaseApi, refreshTokens, SupabaseApiError } from "./supabase-api";
import { copyPortion, verifyMove, type CopyProgress } from "./move";
import { syncTeam, type TeamDatabase } from "./sync";

// Setting up a team's Supabase project, one step per call (path C, step 1.5).
// A new project takes a minute or two to come up, so the page asks again every
// few seconds; each call does what the next step needs and records it, so a
// closed tab or a failed call simply continues next time.

export type SetupRow = TeamDatabase & {
  project_ref: string | null;
  management_token_encrypted: string | null;
  last_error: string | null;
  setup_progress: CopyProgress | null;
};

export const SETUP_COLUMNS =
  "workspace_id, project_url, publishable_key, secret_key_encrypted, db_url_encrypted, schema_version, status, project_ref, management_token_encrypted, setup_step, last_error, setup_progress";

// One call of the setup may run for a minute; the copy stops well before that.
const COPY_BUDGET_MS = 35_000;

// A fresh Management API token; Supabase rotates the refresh token, so it is stored again.
export async function managementToken(admin: SupabaseClient, row: Pick<SetupRow, "workspace_id" | "management_token_encrypted">) {
  if (!row.management_token_encrypted) throw new SupabaseApiError("no Supabase access", 401);
  const tokens = await refreshTokens(decrypt(row.management_token_encrypted));
  await admin.from("team_databases").update({ management_token_encrypted: encrypt(tokens.refreshToken) }).eq("workspace_id", row.workspace_id);
  return tokens.accessToken;
}

// How migrations reach a team database: the Management API when the team
// connected through Supabase, a connection string otherwise.
// The team database with its secret key, on our server only.
function teamClient(row: SetupRow) {
  if (!row.project_url || !row.secret_key_encrypted) throw new Error("team database not ready");
  return createSupabaseClient(row.project_url, decrypt(row.secret_key_encrypted), { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function teamExecutor(admin: SupabaseClient, row: SetupRow): Promise<TeamExecutor> {
  if (row.management_token_encrypted && row.project_ref) {
    const api = supabaseApi(await managementToken(admin, row));
    const ref = row.project_ref;
    return managementExecutor((sql) => api.query(ref, sql));
  }
  if (row.db_url_encrypted) return postgresExecutor(decrypt(row.db_url_encrypted));
  throw new Error("no way to reach the team database");
}

export type SetupProgress = { step: NonNullable<SetupRow["setup_step"]>; waiting?: string; error?: string; copying?: string };

export async function advanceSetup(admin: SupabaseClient, row: SetupRow, issuer: string): Promise<SetupProgress> {
  const save = (values: Record<string, unknown>) => admin.from("team_databases").update(values).eq("workspace_id", row.workspace_id);
  const step = row.setup_step ?? "project";
  const ref = row.project_ref;
  if (!ref) return { step, error: "no_project" };
  try {
    if (step === "project") {
      const api = supabaseApi(await managementToken(admin, row));
      const project = await api.project(ref);
      if (project.status === "INACTIVE") await api.restore(ref);
      if (project.status !== "ACTIVE_HEALTHY") return { step, waiting: project.status };
      await save({ setup_step: "schema", last_error: null });
      return { step: "schema" };
    }
    if (step === "schema") {
      const executor = await teamExecutor(admin, row);
      const migrations = loadTeamMigrations();
      await migrateTeam(executor, migrations);
      await save({ setup_step: "keys", schema_version: migrations.at(-1)?.name ?? null, last_error: null });
      return { step: "keys" };
    }
    if (step === "keys") {
      const api = supabaseApi(await managementToken(admin, row));
      const keys = await api.apiKeys(ref);
      const publishable = keys.find((k) => k.type === "publishable")?.api_key;
      const secret = keys.find((k) => k.type === "secret" && k.api_key)?.api_key ?? (await api.createSecretKey(ref)).api_key;
      // Not every project has the new keys yet; then nothing is stored and the owner is told.
      if (!publishable || !secret) return { step, error: "no_api_keys" };
      await save({
        project_url: `https://${ref}.supabase.co`,
        publishable_key: publishable,
        secret_key_encrypted: encrypt(secret),
        setup_step: "sync",
        last_error: null,
      });
      return { step: "sync" };
    }
    if (step === "sync") {
      // Members and our issuer go in before the project starts trusting our tokens.
      await syncTeam(admin, row, issuer);
      await save({ setup_step: "copy", setup_progress: null });
      return { step: "copy" };
    }
    // The workspace's existing pages, comments and files (step 1.7b; nothing to
    // copy for a new workspace). Until "done" the wiki keeps reading them
    // centrally and refuses changes.
    if (step === "copy") {
      const team = teamClient(row);
      const started = Date.now();
      let progress = row.setup_progress;
      let stage = "";
      do {
        const { result, next } = await copyPortion(admin, team, row.workspace_id, progress);
        stage = result.stage;
        progress = next;
        // Saved after every portion: a call cut short continues from here.
        await save(next ? { setup_progress: next, last_error: null } : { setup_step: "verify", setup_progress: null, last_error: null });
        if (!next) return { step: "verify" };
      } while (Date.now() - started < COPY_BUDGET_MS);
      return { step, copying: stage };
    }
    if (step === "verify") {
      const report = await verifyMove(admin, teamClient(row), row.workspace_id);
      if (!report.ok) {
        // "Try again" copies everything once more before checking again.
        await save({ move_report: report, setup_step: "copy", setup_progress: null, last_error: "verify_failed" });
        return { step, error: "verify_failed" };
      }
      await save({ move_report: report, moved_at: new Date().toISOString(), setup_step: "sign_in", last_error: null });
      return { step: "sign_in" };
    }
    if (step === "sign_in") {
      const api = supabaseApi(await managementToken(admin, row));
      const existing = await api.thirdPartyAuth(ref);
      if (!existing.some((integration) => integration.oidc_issuer_url?.replace(/\/$/, "") === issuer)) {
        await api.addOidcIssuer(ref, issuer);
      }
      await save({ setup_step: "done", status: "ok", last_error: null });
      return { step: "done" };
    }
    return { step };
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 300);
    await save({ last_error: message });
    return { step, error: message };
  }
}

// Brings every connected team database to the current schema; one failing
// doesn't stop the others.
export async function migrateAllTeams(admin: SupabaseClient): Promise<TeamMigrationResult[]> {
  const { data } = await admin.from("team_databases").select(SETUP_COLUMNS).or("setup_step.is.null,setup_step.eq.done");
  const rows = (data ?? []) as SetupRow[];
  const migrations = loadTeamMigrations();
  const executors = new Map<string, TeamExecutor>();
  for (const row of rows) {
    try {
      executors.set(row.workspace_id, await teamExecutor(admin, row));
    } catch {
      // Reported below as unreachable.
    }
  }
  const results = await migrateTeams(
    rows.map((row) => ({
      team: row.workspace_id,
      executor: () => {
        const executor = executors.get(row.workspace_id);
        if (!executor) throw new Error("no access to the team database");
        return executor;
      },
    })),
    migrations,
  );
  for (const result of results) {
    await admin
      .from("team_databases")
      .update(result.error ? { status: "error", last_error: result.error } : { schema_version: migrations.at(-1)?.name ?? null, last_error: null })
      .eq("workspace_id", result.team);
  }
  return results;
}

let latestName: string | null | undefined;
export function latestTeamMigration() {
  if (latestName === undefined) latestName = loadTeamMigrations().at(-1)?.name ?? null;
  return latestName;
}

// A team database behind the current schema (a new version of the wiki came
// out since): bring it up to date before using it.
export async function upgradeTeam(admin: SupabaseClient, workspaceId: string) {
  const { data } = await admin.from("team_databases").select(SETUP_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  const row = data as SetupRow | null;
  if (!row) return;
  const migrations = loadTeamMigrations();
  await migrateTeam(await teamExecutor(admin, row), migrations);
  await admin.from("team_databases").update({ schema_version: migrations.at(-1)?.name ?? null, last_error: null }).eq("workspace_id", workspaceId);
}
