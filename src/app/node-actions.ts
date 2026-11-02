"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { newMap } from "@/lib/nodes";
import { t } from "@/i18n";

// Node space (step Н1): every check is in the database functions; these forward
// the call to wherever the workspace keeps its data.

async function call<T extends object = object>(shortId: string | undefined, fn: string, args: Record<string, unknown>, refresh = true): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  if (refresh) revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createNodeMap(shortId: string, kind: "mindmap" | "flow", data?: unknown, title?: string) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "nodes",
    new_kind: kind,
    new_title: (title ?? "").slice(0, 200),
    new_data: data ?? (kind === "flow" ? { nodes: [], edges: [] } : newMap(t.nodes.centralTopic)),
  });
}

// Saved often while editing: no page refresh.
export async function saveNodeMap(shortId: string, id: string, title: string | null, data: unknown, version: number) {
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: title, new_data: data, base_version: version }, false);
}

export async function trashNodeMap(shortId: string, id: string, restore = false) {
  return call(shortId, "trash_service_object", { target_object: id, restore });
}

export async function deleteNodeMapForever(shortId: string, id: string) {
  return call(shortId, "delete_service_object_forever", { target_object: id });
}

export async function setNodeMapWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}

export async function setNodeMapMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}

export async function setNodeMapGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}

// Step Н3: maps and diagrams inside wiki pages (and in search), read with the
// reader's own access — someone who can't open the map gets nothing.

export type NodeObjectSummary = { id: string; title: string; kind: "mindmap" | "flow" };
export type NodeObjectView = NodeObjectSummary & { data: unknown; version: number; canEdit: boolean };

export async function nodeObjectsForEmbed(shortId: string): Promise<NodeObjectSummary[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const { data } = await db
    .from("service_objects")
    .select("id, title, kind")
    .eq("workspace_id", workspace.id)
    .eq("service", "nodes")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? []) as NodeObjectSummary[];
}

export async function nodeObjectView(shortId: string, id: string): Promise<NodeObjectView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await dataClient(shortId);
  const [{ data }, { data: role }] = await Promise.all([
    db.from("service_objects").select("id, title, kind, data, version, deleted_at").eq("id", id).eq("service", "nodes").maybeSingle(),
    db.rpc("service_object_role", { target_object: id }),
  ]);
  if (!data || !role || data.deleted_at) return null;
  return { id: data.id, title: data.title, kind: data.kind, data: data.data, version: data.version, canEdit: role === "owner" || role === "editor" };
}

export type NodeObjectHit = NodeObjectSummary & { snippet: string };

// Maps and diagrams whose title or text has the words (search "Карти").
export async function searchNodeObjects(shortId: string, query: string): Promise<NodeObjectHit[]> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return [];
  const db = await dataClient(shortId);
  const words = query.trim().slice(0, 200);
  let request = db.from("service_objects").select("id, title, kind, search_text").eq("workspace_id", workspace.id).eq("service", "nodes").is("deleted_at", null);
  if (words) {
    const like = `%${words.replace(/[%_\\,()]/g, " ")}%`;
    request = request.or(`title.ilike.${like},search_text.ilike.${like}`);
  }
  const { data } = await request.order("updated_at", { ascending: false }).limit(20);
  return ((data ?? []) as (NodeObjectSummary & { search_text: string })[]).map((row) => {
    const at = words ? row.search_text.toLowerCase().indexOf(words.toLowerCase()) : -1;
    return { id: row.id, title: row.title, kind: row.kind, snippet: at >= 0 ? row.search_text.slice(Math.max(0, at - 30), at + words.length + 50) : row.search_text.slice(0, 80) };
  });
}
