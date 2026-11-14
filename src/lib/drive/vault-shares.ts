import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { DriveError, driveApi } from "./google-drive";
import { connectionById, noteDriveError, refreshTokenOf, type DriveConnection } from "./storage";
import { filesHome } from "./task-files";

// VAULT-2b: Vault's access mirrored on the team's Google Drive. The database says who
// should have each Drive-kept file (vault_drive_wanted: members with a role in Vault,
// never guests or former members); this brings the Drive's own sharing in step with it,
// a portion at a time, without notification emails, and remembers what it did
// (vault_drive_shares). A refusal (an address with no Google account) is kept and tried
// again after a day. Server only: the Drive's access never reaches the browser.

type Wanted = { item_id: string; drive_account_id: string | null; drive_file_id: string; email: string; role: "reader" | "writer" };
type Share = { item_id: string; email: string; role: "reader" | "writer"; drive_file_id: string; permission_id: string | null; error: string | null; updated_at: string };
export type ShareSync = { shared: number; changed: number; removed: number; failed: number };

const RETRY_AFTER = 24 * 3600_000;

export async function syncVaultDriveShares(admin: SupabaseClient, workspaceId: string, budget = 200): Promise<ShareSync | null> {
  const { rows } = await filesHome(admin, workspaceId);
  const [{ data: wantedRows, error: wantedError }, { data: currentRows, error: currentError }] = await Promise.all([
    rows.rpc("vault_drive_wanted", { ws: workspaceId }),
    rows.from("vault_drive_shares").select("item_id, email, role, drive_file_id, permission_id, error, updated_at").eq("workspace_id", workspaceId),
  ]);
  // A database not yet upgraded has neither: nothing to do.
  if (wantedError || currentError) return null;
  const wanted = (wantedRows ?? []) as Wanted[];
  const current = new Map(((currentRows ?? []) as Share[]).map((s) => [`${s.item_id}|${s.email}`, s]));
  const files = new Map(wanted.map((w) => [w.item_id, w]));
  const connections = new Map<string, DriveConnection | null>();
  const connectionOf = async (id: string | null) => {
    if (!id) return null;
    if (!connections.has(id)) connections.set(id, await connectionById(admin, id));
    return connections.get(id) ?? null;
  };
  const result: ShareSync = { shared: 0, changed: 0, removed: 0, failed: 0 };
  let left = budget;
  // The Drive's own account owns the files already; a broken connection stops its files here.
  const broken = new Set<string>();
  const save = (row: Omit<Share, "updated_at">) =>
    rows.from("vault_drive_shares").upsert({ workspace_id: workspaceId, updated_at: new Date().toISOString(), ...row }, { onConflict: "item_id,email" });

  for (const w of wanted) {
    if (left <= 0) break;
    const had = current.get(`${w.item_id}|${w.email}`);
    // Still wanted: never taken away below, even when nothing can be done now.
    current.delete(`${w.item_id}|${w.email}`);
    const connection = await connectionOf(w.drive_account_id);
    if (!connection || broken.has(connection.id) || connection.account_email.toLowerCase() === w.email) continue;
    // A new version is another Drive file: the old one's permission goes, the new one is shared.
    const moved = had?.permission_id && had.drive_file_id !== w.drive_file_id;
    if (moved && had?.permission_id) {
      await driveApi().unshare(refreshTokenOf(connection), had.drive_file_id, had.permission_id).catch(() => {});
    }
    if (had?.permission_id && !moved && had.role === w.role) continue;
    if (had && !had.permission_id && had.error && Date.now() - new Date(had.updated_at).getTime() < RETRY_AFTER) continue;
    left -= 1;
    try {
      if (had?.permission_id && !moved) {
        await driveApi().updateShare(refreshTokenOf(connection), w.drive_file_id, had.permission_id, w.role);
        await save({ item_id: w.item_id, email: w.email, role: w.role, drive_file_id: w.drive_file_id, permission_id: had.permission_id, error: null });
        result.changed += 1;
      } else {
        const permission = await driveApi().share(refreshTokenOf(connection), w.drive_file_id, w.email, w.role);
        await save({ item_id: w.item_id, email: w.email, role: w.role, drive_file_id: w.drive_file_id, permission_id: permission, error: null });
        result.shared += 1;
      }
    } catch (error) {
      // 401: the connection itself is gone (noted once). Anything else is about this address.
      if (error instanceof DriveError && error.status === 401) {
        broken.add(connection.id);
        await noteDriveError(admin, connection, error);
        continue;
      }
      await save({ item_id: w.item_id, email: w.email, role: w.role, drive_file_id: w.drive_file_id, permission_id: null, error: error instanceof Error ? error.message.slice(0, 200) : "refused" });
      result.failed += 1;
    }
  }

  // What is shared but no longer wanted (role taken away, binned, a guest, gone from the workspace).
  for (const share of current.values()) {
    if (left <= 0) break;
    // The file itself left the Drive or Vault: its row goes (cascade), its permission with the file.
    const file = files.get(share.item_id) ?? (await fileOf(rows, share.item_id));
    left -= 1;
    try {
      if (share.permission_id && file) {
        const connection = await connectionOf(file.drive_account_id);
        if (connection && !broken.has(connection.id)) await driveApi().unshare(refreshTokenOf(connection), share.drive_file_id, share.permission_id);
      }
      await rows.from("vault_drive_shares").delete().eq("item_id", share.item_id).eq("email", share.email);
      result.removed += 1;
    } catch (error) {
      if (error instanceof DriveError && error.status === 401) continue;
      result.failed += 1;
    }
  }
  return result;
}

async function fileOf(rows: SupabaseClient, itemId: string) {
  const { data } = await rows.from("vault_items").select("drive_account_id, drive_file_id").eq("id", itemId).maybeSingle();
  return data as { drive_account_id: string | null; drive_file_id: string | null } | null;
}

// Every workspace with a Drive (the daily run), each within its budget.
export async function syncAllVaultDriveShares(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("drive_connections").select("workspace_id").eq("active", true).eq("status", "ok");
  let done = 0;
  for (const { workspace_id } of (data ?? []) as { workspace_id: string }[]) {
    const result = await syncVaultDriveShares(admin, workspace_id).catch(() => null);
    if (result) done += result.shared + result.changed + result.removed;
  }
  return done;
}

// After a change of access, a move, the bin, an upload to the Drive or a person leaving:
// brought in step once the answer has gone back (the person doesn't wait for the Drive).
export function syncVaultSharesLater(workspaceId: string) {
  after(async () => {
    const admin = createAdminClient();
    if (admin) await syncVaultDriveShares(admin, workspaceId).catch(() => null);
  });
}
