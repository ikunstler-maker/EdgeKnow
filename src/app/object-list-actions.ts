"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { ObjectAccess } from "@/components/access/object-access";
import type { Person } from "@/lib/tasks";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { withPaths } from "@/lib/groups";
import { t } from "@/i18n";

// UI-5: what a service's list offers on each row — rename, duplicate, access, to the bin —
// for boards, designs, maps, tables, slide decks and surveys. Every check stays in the
// database functions the editors already use; these only forward the call.

export type ListService = "boards" | "nodes" | "sheets" | "slides" | "surveys";
const SERVICES: readonly string[] = ["boards", "nodes", "sheets", "slides", "surveys"];

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

async function objectOf(shortId: string, id: string) {
  const db = await dataClient(shortId);
  const { data } = await db.from("service_objects").select("id, service, kind, title, data, version, workspace_role, deleted_at").eq("id", id).maybeSingle();
  const row = data as { id: string; service: string; kind: string; title: string; data: unknown; version: number; workspace_role: string | null; deleted_at: string | null } | null;
  return row && !row.deleted_at && SERVICES.includes(row.service) ? row : null;
}

export async function renameListObject(shortId: string, id: string, title: string): Promise<ActionResult> {
  const name = title.trim().slice(0, 200);
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await objectOf(shortId, id);
    if (!row) return { ok: false, error: "forbidden" };
    const result = await call(shortId, "save_service_object", { target_object: id, new_title: name, new_data: null, base_version: row.version });
    // Someone saved in between: read the new version and try once more (the name alone changes).
    if (result.ok || result.error !== "conflict") return result;
  }
  return { ok: false, error: "conflict" };
}

export async function duplicateListObject(shortId: string, id: string): Promise<ActionResult<{ id: string }>> {
  const workspace = await getWorkspace(shortId);
  const row = workspace ? await objectOf(shortId, id) : null;
  if (!workspace || !row) return { ok: false, error: "forbidden" };
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: row.service,
    new_kind: row.kind,
    new_title: t.common.copyName(row.title || t.pages.untitled).slice(0, 200),
    new_data: row.data,
  });
}

export async function trashListObject(shortId: string, id: string): Promise<ActionResult> {
  return call(shortId, "trash_service_object", { target_object: id, restore: false });
}

// What the access dialog needs — only its owner gets it.
export async function listObjectAccess(shortId: string, id: string): Promise<ActionResult<{ access: ObjectAccess; members: Person[] }>> {
  const workspace = await getWorkspace(shortId);
  const row = workspace ? await objectOf(shortId, id) : null;
  if (!workspace || !row) return { ok: false, error: "forbidden" };
  const db = await dataClient(shortId);
  const { data: role } = await db.rpc("service_object_role", { target_object: id });
  if (role !== "owner") return { ok: false, error: "forbidden" };
  const [{ data: people }, { data: groupGrants }, { data: groups }, { data: memberRows }] = await Promise.all([
    db.from("service_object_access").select("user_id, role").eq("object_id", id),
    db.from("service_object_group_access").select("group_id, role").eq("object_id", id),
    db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id).order("name"),
    db
      .from("workspace_members")
      .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
  ]);
  return {
    ok: true,
    access: {
      workspaceRole: row.workspace_role,
      people: (people ?? []) as ObjectAccess["people"],
      groupGrants: (groupGrants ?? []) as ObjectAccess["groupGrants"],
      groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]),
    },
    members: (memberRows ?? []).flatMap((m) => (m.profile ? [{ id: m.user_id, name: m.profile.name, email: m.profile.email, guest: m.role === "guest" }] : [])),
  };
}

export async function setListObjectWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}
export async function setListObjectMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}
export async function setListObjectGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}
