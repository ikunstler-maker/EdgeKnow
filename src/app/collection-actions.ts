"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { writeClient } from "@/lib/team-db/data";

// Sidebar collections: every check (who may change them, which objects) is in the database.
async function call(fn: string, args: Record<string, unknown>): Promise<ActionResult<{ id?: string }>> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<{ id?: string }>;
}

export async function saveCollection(workspaceId: string, id: string | null, service: string | null, name: string, position: number | null) {
  return call("save_object_collection", { ws: workspaceId, collection_id: id, new_service: service, new_name: name, new_position: position });
}

export async function deleteCollection(id: string) {
  return call("delete_object_collection", { target: id });
}

export async function setCollectionItem(collectionId: string, objectId: string, inside: boolean) {
  return call("set_collection_item", { target_collection: collectionId, target_object: objectId, inside });
}
