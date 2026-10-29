import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Moving a workspace's existing data into its team's own database (path C,
// step 1.7b). Runs as two setup steps, a little at a time (each call of the
// setup has under a minute):
//   copy   — table by table, in portions; every portion is an "insert or
//            overwrite", so a repeated or interrupted portion is harmless;
//   verify — row counts of every table and every page's title and contents must
//            match exactly; otherwise nothing switches.
// The central rows are only read, never changed.

const BATCH = 200;
const FILE_BATCH = 20;

export type CopyProgress = { stage: number; offset: number };

type Stage = {
  name: string;
  table: string;
  columns: string;
  order: string;
  onConflict: string;
  // Pages go in twice: first without their parent (so a child never comes before
  // its parent), then with it.
  flatten?: boolean;
  merge?: boolean;
  files?: boolean;
  // The team database fills these itself when pages arrive (from what it can see
  // so far), so its own rows are cleared first and the central ones taken as they are.
  replace?: boolean;
};

const PAGE_COLUMNS =
  "id, parent_id, owner_id, title, icon, position, content, version, created_at, updated_at, updated_by, deleted_at, deleted_by, trashed_with, workspace_id, created_by, inherit, workspace_role, cover";

const STAGES: Stage[] = [
  { name: "pages", table: "pages", columns: PAGE_COLUMNS, order: "id", onConflict: "id", flatten: true },
  { name: "page tree", table: "pages", columns: "id, parent_id, workspace_id", order: "id", onConflict: "id", merge: true },
  { name: "access", table: "page_access", columns: "id, workspace_id, page_id, user_id, role, granted_by, created_at", order: "id", onConflict: "id" },
  {
    name: "threads",
    table: "comment_threads",
    columns: "id, workspace_id, page_id, quoted_text, status, created_by, created_at, resolved_by, resolved_at",
    order: "id",
    onConflict: "id",
  },
  { name: "comments", table: "comments", columns: "id, workspace_id, thread_id, author_id, body, mentions, created_at, edited_at", order: "id", onConflict: "id" },
  {
    name: "files",
    table: "attachments",
    columns: "id, workspace_id, page_id, storage_path, mime_type, bytes, width, height, uploaded_by, created_at, storage_backend, drive_connection_id, drive_file_id",
    order: "id",
    onConflict: "id",
    files: true,
  },
  {
    name: "mentions",
    table: "page_mentions",
    columns: "workspace_id, page_id, user_id, mentioned_by, created_at",
    order: "page_id,user_id",
    onConflict: "page_id,user_id",
    replace: true,
  },
  {
    name: "statistics",
    table: "page_contributions",
    columns: "workspace_id, page_id, user_id, chars_added, chars_removed, saves, last_saved_at",
    order: "page_id,user_id",
    onConflict: "page_id,user_id",
  },
];

// Tables compared row for row in "verify" (audit log entries get new ids, so they are only copied).
const COUNTED = ["pages", "page_access", "comment_threads", "comments", "attachments", "page_mentions", "page_contributions"];

export type CopyResult = { done: boolean; stage: string; copied: number };

// One portion of the copy. `team` is the team database with its secret key.
export async function copyPortion(admin: SupabaseClient, team: SupabaseClient, ws: string, progress: CopyProgress | null): Promise<{ result: CopyResult; next: CopyProgress | null }> {
  const at = progress ?? { stage: -1, offset: 0 };

  // First: the people all that data points to, then the (recent) workspace log.
  if (at.stage === -1) {
    // A repeated move: whatever is gone centrally since (trash emptied overnight)
    // goes in the team database too, so the counts can match.
    await prune(admin, team, ws);
    const { data: people, error } = await admin.rpc("team_move_people", { ws });
    if (error) throw new Error(`people: ${error.message}`);
    const rows = (people ?? []) as Record<string, unknown>[];
    if (rows.length) {
      const { error: insertError } = await team.from("profiles").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (insertError) throw new Error(`people: ${insertError.message}`);
    }
    const { count } = await team.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    if (!count) {
      const { data: log } = await admin
        .from("audit_log")
        .select("workspace_id, actor_id, action, details, created_at")
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (log?.length) {
        const { error: logError } = await team.from("audit_log").insert(log);
        if (logError) throw new Error(`log: ${logError.message}`);
      }
    }
    return { result: { done: false, stage: "people", copied: rows.length }, next: { stage: 0, offset: 0 } };
  }

  const stage = STAGES[at.stage];
  if (!stage) return { result: { done: true, stage: "done", copied: 0 }, next: null };
  const size = stage.files ? FILE_BATCH : BATCH;
  if (stage.replace && at.offset === 0) {
    const { error: clearError } = await team.from(stage.table).delete().eq("workspace_id", ws);
    if (clearError) throw new Error(`${stage.name}: ${clearError.message}`);
  }
  const { data, error } = await admin
    .from(stage.table)
    .select(stage.columns)
    .eq("workspace_id", ws)
    .order(stage.order.split(",")[0])
    .order(stage.order.split(",")[1] ?? stage.order.split(",")[0])
    .range(at.offset, at.offset + size - 1);
  if (error) throw new Error(`${stage.name}: ${error.message}`);
  let rows = (data ?? []) as unknown as Record<string, unknown>[];

  if (rows.length) {
    if (stage.flatten) rows = rows.map((row) => ({ ...row, parent_id: null }));
    if (stage.merge) {
      // Parents are all in place now; only pages that have one need the update.
      for (const row of rows.filter((r) => r.parent_id)) {
        const { error: updateError } = await team.from("pages").update({ parent_id: row.parent_id }).eq("id", row.id as string);
        if (updateError) throw new Error(`${stage.name}: ${updateError.message}`);
      }
    } else {
      if (stage.files) await copyFiles(admin, team, rows);
      const { error: insertError } = await team.from(stage.table).upsert(rows, { onConflict: stage.onConflict });
      if (insertError) throw new Error(`${stage.name}: ${insertError.message}`);
    }
  }

  const next = rows.length < size ? { stage: at.stage + 1, offset: 0 } : { stage: at.stage, offset: at.offset + size };
  return { result: { done: next.stage >= STAGES.length, stage: stage.name, copied: rows.length }, next: next.stage >= STAGES.length ? null : next };
}

// Tables whose rows are copied by id; the rest go with their page.
const BY_ID = ["comments", "comment_threads", "attachments", "page_access", "pages"];

async function idsOf(client: SupabaseClient, table: string, ws: string) {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(table).select("id").eq("workspace_id", ws).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data ?? []) ids.add(row.id as string);
    if (!data || data.length < 1000) return ids;
  }
}

async function prune(admin: SupabaseClient, team: SupabaseClient, ws: string) {
  for (const table of BY_ID) {
    const there = await idsOf(team, table, ws);
    if (!there.size) continue;
    const central = await idsOf(admin, table, ws);
    const extra = [...there].filter((id) => !central.has(id));
    for (let i = 0; i < extra.length; i += 100) {
      const { error } = await team.from(table).delete().in("id", extra.slice(i, i + 100));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
}

// Files kept in the central Supabase Storage go to the team's storage under the
// same path (files on Google Drive stay where they are).
async function copyFiles(admin: SupabaseClient, team: SupabaseClient, rows: Record<string, unknown>[]) {
  for (const row of rows.filter((r) => r.storage_backend === "supabase")) {
    const path = row.storage_path as string;
    const { data: there } = await team.storage.from("attachments").exists(path);
    if (there) continue;
    const { data: file, error } = await admin.storage.from("attachments").download(path);
    // A file that is already gone centrally (deleted, never uploaded) has nothing to copy.
    if (error || !file) continue;
    const { error: uploadError } = await team.storage
      .from("attachments")
      .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: row.mime_type as string, upsert: true });
    if (uploadError) throw new Error(`file ${path}: ${uploadError.message}`);
  }
}

export type VerifyReport = { ok: boolean; counts: Record<string, { central: number; team: number }>; mismatchedPages: string[]; missingFiles: string[] };

async function countOf(client: SupabaseClient, table: string, ws: string) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function allPages(client: SupabaseClient, ws: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("pages")
      .select("id, parent_id, title, icon, content, version, deleted_at, position, owner_id, cover")
      .eq("workspace_id", ws)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(`pages: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 500) return rows;
  }
}

// Both databases store page contents as jsonb, so equal contents print equally.
export async function verifyMove(admin: SupabaseClient, team: SupabaseClient, ws: string): Promise<VerifyReport> {
  const counts: VerifyReport["counts"] = {};
  for (const table of COUNTED) counts[table] = { central: await countOf(admin, table, ws), team: await countOf(team, table, ws) };
  const [central, copied] = await Promise.all([allPages(admin, ws), allPages(team, ws)]);
  const byId = new Map(copied.map((row) => [row.id as string, JSON.stringify(row)]));
  const mismatchedPages = central.filter((row) => byId.get(row.id as string) !== JSON.stringify(row)).map((row) => row.id as string);

  const missingFiles: string[] = [];
  const { data: files } = await admin.from("attachments").select("storage_path").eq("workspace_id", ws).eq("storage_backend", "supabase");
  for (const file of files ?? []) {
    const { data: centrally } = await admin.storage.from("attachments").exists(file.storage_path);
    if (!centrally) continue;
    const { data: there } = await team.storage.from("attachments").exists(file.storage_path);
    if (!there) missingFiles.push(file.storage_path);
  }

  const ok = Object.values(counts).every((c) => c.central === c.team) && !mismatchedPages.length && !missingFiles.length;
  return { ok, counts, mismatchedPages: mismatchedPages.slice(0, 20), missingFiles: missingFiles.slice(0, 20) };
}
