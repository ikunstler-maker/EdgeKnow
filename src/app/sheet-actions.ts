"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { emptyWorkbook } from "@/lib/sheets";
import { t } from "@/i18n";

// Tables (step Т1): objects of the service "sheets" in the shared objects table.
// Every check is in the database functions; these forward the call to wherever
// the workspace keeps its data.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>, refresh = true): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  if (refresh) revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createSheet(shortId: string, title?: string) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "sheets",
    new_kind: "sheet",
    new_title: (title ?? "").slice(0, 200),
    new_data: emptyWorkbook(t.sheets.firstSheet),
  });
}

// Saved often while working: no page refresh.
export async function saveSheet(shortId: string, id: string, title: string | null, data: unknown, version: number) {
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: title, new_data: data, base_version: version }, false);
}

export async function trashSheet(shortId: string, id: string, restore = false) {
  return call(shortId, "trash_service_object", { target_object: id, restore });
}

export async function deleteSheetForever(shortId: string, id: string) {
  return call(shortId, "delete_service_object_forever", { target_object: id });
}

export async function setSheetWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}

export async function setSheetMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}

export async function setSheetGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}
