"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { ObjectAccess } from "@/components/access/object-access";
import type { Person } from "@/lib/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { OBJECT_FILE_COLUMNS, filesHome, readTaskFile, storeTaskFile, workspaceDestination, type StoredFile } from "@/lib/drive/task-files";
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
  // Read with the person's own access: only what they can open can be copied.
  const row = workspace ? await objectOf(shortId, id) : null;
  if (!workspace || !row) return { ok: false, error: "forbidden" };
  const made = await call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: row.service,
    new_kind: row.kind,
    new_title: t.common.copyName(row.title || t.pages.untitled).slice(0, 200),
    new_data: row.data,
  });
  if (!made.ok) return made;
  await copyPictures(shortId, row.id, made.id);
  return made;
}

// UI-5b: the pictures of a board, design or slide deck become the copy's own files (like a
// wishlist's copy); the copy's contents then point to them. A picture that can't be copied
// keeps pointing to the original's file.
async function copyPictures(shortId: string, sourceId: string, copyId: string) {
  const db = await writeClient(shortId);
  const admin = createAdminClient();
  if (!db || !admin) return;
  const { data: copy } = await db.from("service_objects").select("title, data, version, workspace_id").eq("id", copyId).single();
  if (!copy) return;
  const { rows } = await filesHome(admin, copy.workspace_id as string);
  const { data: files } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("object_id", sourceId).limit(500);
  if (!files?.length) return;
  const to = await workspaceDestination(admin, copy.workspace_id as string);
  if ("error" in to) return;
  const moved = new Map<string, string>();
  for (const file of files as StoredFile[]) {
    try {
      const bytes = await readTaskFile(admin, rows, file);
      const { data: reg } = await db.rpc("register_object_file", { target_object: copyId, file_name: file.name, file_type: file.mime_type, file_bytes: bytes.length });
      const r = reg as { ok: boolean; id?: string } | null;
      if (!r?.ok || !r.id) continue;
      const { data: fresh } = await rows.from("object_files").select(OBJECT_FILE_COLUMNS).eq("id", r.id).single();
      await storeTaskFile(admin, rows, fresh as StoredFile, bytes, to);
      moved.set(file.id, r.id);
    } catch {
      // Left pointing to the original's picture.
    }
  }
  if (!moved.size) return;
  // File ids are unique, so swapping them anywhere in the contents is exact.
  let text = JSON.stringify(copy.data ?? null);
  for (const [from, into] of moved) text = text.split(from).join(into);
  await db.rpc("save_service_object", { target_object: copyId, new_title: null, new_data: JSON.parse(text), base_version: copy.version });
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
