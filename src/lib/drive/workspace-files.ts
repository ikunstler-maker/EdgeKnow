import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OBJECT_FILE_COLUMNS, TASK_FILE_COLUMNS, VAULT_FILE_COLUMNS, filesHome, isAt, moveTaskFile, spaceAt, workspaceDestination, type Destination, type StoredFile } from "./task-files";

// Settings → Storage for task files (step U1): how many are not yet in the
// workspace's one storage, the space there now and after, moving them, and
// forgetting the old personal and project Drive accesses once nothing uses them.

export type TaskFilesStatus = {
  count: number;
  bytes: number;
  toMove: number;
  toMoveBytes: number;
  // Where they go: the wiki's Drive, EdgeKnow's (or the team's) storage, or nowhere now (the Drive has a problem).
  target: "drive" | "storage" | "error";
  space: { limit: number | null; used: number } | null;
  // Rows and EdgeKnow-storage bytes are in the team's own database.
  team: boolean;
};

// Task files and board pictures (step Д3b): both live in the one storage; Vault's too (VAULT-2).
async function allTaskFiles(rows: SupabaseClient, workspaceId: string) {
  const files: StoredFile[] = [];
  for (const [table, columns] of [["task_files", TASK_FILE_COLUMNS], ["object_files", OBJECT_FILE_COLUMNS]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data } = await rows.from(table).select(columns).eq("workspace_id", workspaceId).neq("storage_backend", "pending").order("created_at").range(from, from + 999);
      files.push(...((data ?? []) as unknown as StoredFile[]));
      if (!data || data.length < 1000) break;
    }
  }
  // Vault's own files up to 4 MB (larger ones live only on the Drive, in parts).
  for (let from = 0; ; from += 1000) {
    const { data } = await rows.from("vault_items").select(VAULT_FILE_COLUMNS).eq("workspace_id", workspaceId).eq("kind", "file").eq("large", false).neq("storage_backend", "pending").order("created_at").range(from, from + 999);
    files.push(...((data ?? []) as unknown as StoredFile[]).map((file) => ({ ...file, vault: true })));
    if (!data || data.length < 1000) break;
  }
  return files;
}

async function plan(admin: SupabaseClient, workspaceId: string) {
  const { rows, team } = await filesHome(admin, workspaceId);
  const to = await workspaceDestination(admin, workspaceId);
  const files = await allTaskFiles(rows, workspaceId);
  const moves = "error" in to ? [] : files.filter((file) => !isAt(file, to));
  return { rows, team, to, files, moves };
}

export async function taskFilesStatus(admin: SupabaseClient, workspaceId: string): Promise<TaskFilesStatus> {
  const { team, to, files, moves } = await plan(admin, workspaceId);
  const sum = (list: StoredFile[]) => list.reduce((total, file) => total + Number(file.bytes), 0);
  return {
    count: files.length,
    bytes: sum(files),
    toMove: moves.length,
    toMoveBytes: sum(moves),
    target: "error" in to ? "error" : to.kind,
    space: "error" in to ? null : await spaceAt(admin, to, workspaceId, team),
    team,
  };
}

// Moves files into the one storage for up to ~20 seconds per call; the page calls again until none is left.
export async function moveTaskFilesHome(admin: SupabaseClient, workspaceId: string): Promise<{ moved: number; failed: number; remaining: number } | null> {
  const { rows, to, moves } = await plan(admin, workspaceId);
  if ("error" in to) return null;
  const started = Date.now();
  let moved = 0;
  let failed = 0;
  for (const file of moves) {
    if (Date.now() - started > 20_000) break;
    try {
      await moveTaskFile(admin, rows, file, to as Destination);
      moved += 1;
    } catch {
      failed += 1;
    }
  }
  const remaining = moves.length - moved;
  if (!remaining) await forgetUnusedDriveAccounts(admin, workspaceId, rows);
  return { moved, failed, remaining };
}

// Personal and project Drive accesses no file points to any more are deleted (the files on those Drives stay their owners').
export async function forgetUnusedDriveAccounts(admin: SupabaseClient, workspaceId: string, rows?: SupabaseClient) {
  const home = rows ?? (await filesHome(admin, workspaceId)).rows;
  const { data: accounts } = await admin.from("drive_accounts").select("id").eq("workspace_id", workspaceId);
  const ids = (accounts ?? []).map((a) => a.id as string);
  if (!ids.length) return 0;
  const { data: used } = await home.from("task_files").select("drive_account_id").eq("workspace_id", workspaceId).in("drive_account_id", ids);
  const keep = new Set((used ?? []).map((u) => u.drive_account_id as string));
  const gone = ids.filter((id) => !keep.has(id));
  if (gone.length) await admin.from("drive_accounts").delete().in("id", gone);
  return gone.length;
}
