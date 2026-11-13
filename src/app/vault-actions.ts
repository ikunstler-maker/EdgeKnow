"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import type { VaultListing, VaultSharing } from "@/lib/vault";

// Vault (VAULT-2): every check — who sees, adds, changes or shares what — is in the
// database; these only pass the person's request on with their own session.
async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath(`/w/${shortId}/files`);
  return data as ActionResult<T>;
}

export async function createVaultFolder(shortId: string, workspaceId: string, folder: string | null, name: string) {
  return call<{ id: string }>(shortId, "vault_create_folder", { ws: workspaceId, folder, folder_name: name });
}

export async function renameVaultItem(shortId: string, id: string, name: string) {
  return call(shortId, "vault_rename", { target: id, new_name: name });
}

export async function moveVaultItem(shortId: string, id: string, folder: string | null) {
  return call(shortId, "vault_move", { target: id, folder });
}

export async function trashVaultItem(shortId: string, id: string) {
  return call(shortId, "vault_trash", { target: id });
}

export async function restoreVaultItem(shortId: string, id: string) {
  return call(shortId, "vault_restore", { target: id });
}

export async function deleteVaultItem(shortId: string, id: string) {
  return call(shortId, "vault_delete_forever", { target: id });
}

export async function setVaultMemberRole(shortId: string, id: string, member: string, role: "viewer" | "editor" | null) {
  return call(shortId, "vault_set_member_role", { target: id, member, new_role: role });
}

export async function setVaultGroupRole(shortId: string, id: string, group: string, role: "viewer" | "editor" | null) {
  return call(shortId, "vault_set_group_role", { target: id, grp: group, new_role: role });
}

export async function setVaultGeneral(shortId: string, id: string, inherit: boolean, role: "viewer" | "editor" | null) {
  return call(shortId, "vault_set_general", { target: id, new_inherit: inherit, new_workspace_role: role });
}

export async function setVaultFileLimit(shortId: string, workspaceId: string, limitMb: number | null) {
  const result = await call(shortId, "set_vault_file_limit", { ws: workspaceId, limit_mb: limitMb });
  revalidatePath(`/w/${shortId}/settings`);
  return result;
}

// Reads for the dialogs (folders to move into, who has access).
export async function readVaultFolder(shortId: string, workspaceId: string, folder: string | null): Promise<ActionResult<VaultListing>> {
  const db = await dataClient(shortId);
  const { data, error } = await db.rpc("vault_list", { ws: workspaceId, folder, bin: false });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<VaultListing>;
}

export async function readVaultSharing(shortId: string, id: string): Promise<ActionResult<VaultSharing>> {
  const db = await dataClient(shortId);
  const { data, error } = await db.rpc("vault_sharing", { target: id });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<VaultSharing>;
}

// VAULT-3: one file as another service shows it (null: gone, in the bin, or not the
// viewer's to see — then only "unavailable" shows, never its name).
export type VaultFileView = { id: string; name: string; mime_type: string; bytes: number; large: boolean };
export async function vaultFileView(shortId: string, id: string): Promise<VaultFileView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9]{4,16}$/.test(shortId)) return null;
  const db = await dataClient(shortId);
  const { data } = await db
    .from("vault_items")
    .select("id, name, mime_type, bytes, large")
    .eq("id", id)
    .eq("kind", "file")
    .is("deleted_at", null)
    .neq("storage_backend", "pending")
    .maybeSingle();
  return data ? { ...(data as VaultFileView), bytes: Number((data as VaultFileView).bytes) } : null;
}

// One folder for the "From Vault" picker (the workspace found by its short id).
export async function vaultPickList(shortId: string, folder: string | null): Promise<ActionResult<VaultListing>> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" };
  return readVaultFolder(shortId, workspace.id, folder);
}
