import { NextResponse, type NextRequest } from "next/server";
import { refreshAllStale } from "@/lib/calendar-external";
import { pushAllStale } from "@/lib/calendar-google";
import { driveApi } from "@/lib/drive/google-drive";
import { connectionById, refreshTokenOf } from "@/lib/drive/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readyTeams, teamAdmin } from "@/lib/team-db/files";
import { checkAllTeams } from "@/lib/team-db/health";
import { syncAllVaultDriveShares } from "@/lib/drive/vault-shares";
import { recheckDomains } from "@/lib/domain-dns";
import { rekeyTeamSecrets } from "@/lib/team-db/rekey";

// Daily (vercel.json): checks every team database (step 1.5b) and DNS-proven domains, and deletes files whose attachment record is gone — removed
// from their page, page deleted forever, or workspace deleted — from Supabase
// Storage or from the workspace's Google Drive — centrally and in every team
// database (path C). Needs two Vercel environment
// variables: CRON_SECRET (Vercel sends it as a bearer token) and
// SUPABASE_SECRET_KEY (server-only; never exposed to the browser).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const admin = createAdminClient();
  if (!cronSecret || !admin) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const central = await removeDeleted(admin, admin);
  if (central === null) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  // Team databases (path C) keep their own records of deleted files.
  let teams = 0;
  for (const team of await readyTeams(admin)) {
    teams += (await removeDeleted(admin, teamAdmin(team)).catch(() => 0)) ?? 0;
  }
  // Repeating tasks whose day has come get their next copy (centrally and in every team database).
  let repeated = Number(((await admin.rpc("run_task_recurrences")).data as { made?: number } | null)?.made ?? 0);
  for (const team of await readyTeams(admin)) {
    const made = await teamAdmin(team)
      .rpc("run_task_recurrences")
      .then((r) => Number((r.data as { made?: number } | null)?.made ?? 0), () => 0);
    repeated += made;
  }
  // And how every team database is doing; sleeping ones are woken up before anyone needs them.
  const health = await checkAllTeams(admin);
  // Rate limit counters older than a day are no longer needed.
  await admin.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 24 * 3600_000).toISOString());
  // Team database secrets still under the old key move onto TEAM_DB_KEY (when set).
  const rekeyed = process.env.TEAM_DB_KEY ? await rekeyTeamSecrets(admin).catch(() => ({ changed: 0, failed: 1 })) : null;
  // Domains proven through DNS: is the record still there (weekly per domain)?
  const domains = await recheckDomains(admin);
  // Vault's access mirrored on each team's Google Drive (VAULT-2b).
  const vaultShares = await syncAllVaultDriveShares(admin).catch(() => null);
  // Outside calendars nobody looked at lately are read again (busy time only).
  const calendars = await refreshAllStale(admin).catch(() => null);
  // DOBA-1: people's "Doba" calendars at the provider are brought in line; a sign-in of
  // someone who left the workspace is taken back there.
  const calendarCopies = await pushAllStale(admin).catch(() => null);
  return NextResponse.json({ removed: central + teams, repeated, health, domains, rekeyed, calendars, calendarCopies, vaultShares });
}

// Task files and board pictures share their bucket.
const TASK_FILE_PATH = /^[0-9a-f-]{36}\/(tasks|objects)\//;
// Chat files ("<ws>/chat/…") have theirs.
const CHAT_FILE_PATH = /^[0-9a-f-]{36}\/chat\//;
// So do Vault's ("<ws>/vault/…").
const VAULT_FILE_PATH = /^[0-9a-f-]{36}\/vault\//;

// Files whose record is gone, from Supabase Storage (`rows`' own) or the Drive.
async function removeDeleted(admin: SupabaseClient, rows: SupabaseClient): Promise<number | null> {
  // Survey files added but never sent with an answer (after a day) go the same way.
  await rows.rpc("clean_survey_files");
  // Chat files added to a message that was never sent (after a day) too.
  await rows.rpc("clean_chat_files");
  // Vault: the bin after 30 days, uploads never finished after a day (a database not yet upgraded has no such function).
  await rows.rpc("clean_vault_items");
  // Events cancelled over 30 days ago go for good (a database not yet upgraded has no such function).
  await rows.rpc("purge_calendar_events");
  // Time-off policies that accrue by themselves are brought up to date (nothing is given twice).
  await rows.rpc("run_leave_accruals");
  const { data: found, error } = await rows
    .from("attachment_tombstones")
    .select("storage_path, storage_backend, drive_connection_id, drive_file_id")
    .order("created_at")
    .limit(500);
  if (error) return null;
  if (!found.length) return 0;
  // A path that has a record again (a workspace moved back and forth) keeps its file.
  const paths = found.map((row) => row.storage_path as string);
  const [{ data: inUse, error: inUseError }, { data: taskFilesInUse }, { data: picturesInUse }, { data: chatFilesInUse }, { data: vaultInUse }, { data: versionsInUse }] = await Promise.all([
    rows.from("attachments").select("storage_path").in("storage_path", paths),
    // Task files and board pictures (tables that may not exist yet in an older team database).
    rows.from("task_files").select("storage_path").in("storage_path", paths),
    rows.from("object_files").select("storage_path").in("storage_path", paths),
    rows.from("chat_files").select("storage_path").in("storage_path", paths),
    rows.from("vault_items").select("storage_path").in("storage_path", paths),
    rows.from("vault_versions").select("storage_path").in("storage_path", paths),
  ]);
  if (inUseError) return null;
  const used = new Set([...(inUse ?? []), ...(taskFilesInUse ?? []), ...(picturesInUse ?? []), ...(chatFilesInUse ?? []), ...(vaultInUse ?? []), ...(versionsInUse ?? [])].map((row) => row.storage_path as string));
  if (used.size) await rows.from("attachment_tombstones").delete().in("storage_path", [...used]);
  const tombstones = found.filter((row) => !used.has(row.storage_path as string));

  const done: string[] = [];
  const onSupabase = tombstones.filter((row) => row.storage_backend !== "drive").map((row) => row.storage_path as string);
  // Task files ("<ws>/tasks/…") have their own bucket.
  for (const [bucket, paths] of [
    ["attachments", onSupabase.filter((path) => !TASK_FILE_PATH.test(path) && !CHAT_FILE_PATH.test(path) && !VAULT_FILE_PATH.test(path))],
    ["task-files", onSupabase.filter((path) => TASK_FILE_PATH.test(path))],
    ["chat-files", onSupabase.filter((path) => CHAT_FILE_PATH.test(path))],
    ["vault-files", onSupabase.filter((path) => VAULT_FILE_PATH.test(path))],
  ] as const) {
    if (!paths.length) continue;
    const removed = await rows.storage.from(bucket).remove(paths);
    if (!removed.error) done.push(...paths);
  }
  for (const row of tombstones.filter((r) => r.storage_backend === "drive")) {
    const connection = row.drive_connection_id ? await connectionById(admin, row.drive_connection_id as string) : null;
    try {
      // A Drive that was disconnected or deleted: nothing left to remove from here.
      if (connection && row.drive_file_id) await driveApi().remove(refreshTokenOf(connection), row.drive_file_id as string);
      done.push(row.storage_path as string);
    } catch {
      // Kept for the next run.
    }
  }
  if (done.length) await rows.from("attachment_tombstones").delete().in("storage_path", done);
  return done.length;
}
