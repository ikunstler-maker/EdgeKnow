"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
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

export async function createSheet(shortId: string, title?: string, data?: unknown) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "sheets",
    new_kind: "sheet",
    new_title: (title ?? "").slice(0, 200),
    new_data: data ?? emptyWorkbook(t.sheets.firstSheet),
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

// Step Т4: tables (or one of their charts) inside wiki pages, read live with the
// reader's own access — someone who can't open the table gets nothing — and in search.

export type SheetSummary = { id: string; title: string; charts: { id: string; title: string }[] };
export type SheetView = { id: string; title: string; data: unknown; version: number; canEdit: boolean };

export async function sheetsForEmbed(shortId: string): Promise<SheetSummary[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title, charts:data->charts")
    .eq("workspace_id", workspace.id)
    .eq("service", "sheets")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as { id: string; title: string; charts: { id: string; title: string }[] | null }[]).map((row) => ({
    id: row.id,
    title: row.title,
    charts: (row.charts ?? []).map((chart) => ({ id: chart.id, title: chart.title })),
  }));
}

export async function sheetView(shortId: string, id: string): Promise<SheetView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(shortId);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, data, version, deleted_at").eq("id", id).eq("service", "sheets").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  if (!data || !role || data.deleted_at) return null;
  return { id: data.id, title: data.title, data: data.data, version: data.version, canEdit: role === "owner" || role === "editor" };
}

export type SheetHit = { id: string; title: string; snippet: string };

// Tables whose name, sheet names or cells have the words (search "Таблиці").
export async function searchSheets(shortId: string, query: string): Promise<SheetHit[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const words = query.trim().slice(0, 200);
  let request = db.from("service_objects").select("id, title, search_text").eq("workspace_id", workspace.id).eq("service", "sheets").is("deleted_at", null);
  if (words) {
    const like = `%${words.replace(/[%_\\,()]/g, " ")}%`;
    request = request.or(`title.ilike.${like},search_text.ilike.${like}`);
  }
  const { data } = await request.order("updated_at", { ascending: false }).limit(20);
  return ((data ?? []) as { id: string; title: string; search_text: string }[]).map((row) => {
    const at = words ? row.search_text.toLowerCase().indexOf(words.toLowerCase()) : -1;
    return { id: row.id, title: row.title, snippet: at >= 0 ? row.search_text.slice(Math.max(0, at - 30), at + words.length + 50) : row.search_text.slice(0, 80) };
  });
}
