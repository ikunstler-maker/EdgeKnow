"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

// Permission checks live in the database functions; these actions only forward
// the call and refresh every page that shows the tree.
async function callPageRpc<T extends object = object>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createPage(workspaceId: string, parentId: string | null) {
  return callPageRpc<{ id: string }>("create_page", {
    ws: workspaceId,
    parent: parentId,
    new_title: "",
  });
}

export async function renamePage(id: string, title: string) {
  return callPageRpc("rename_page", { target_page: id, new_title: title });
}

export async function setPageIcon(id: string, icon: string | null) {
  return callPageRpc("set_page_icon", { target_page: id, new_icon: icon });
}

export async function movePage(id: string, parentId: string | null, index: number) {
  return callPageRpc("move_page", { target_page: id, new_parent: parentId, new_index: index });
}

export async function trashPage(id: string) {
  return callPageRpc("trash_page", { target_page: id });
}

export async function restorePage(id: string) {
  return callPageRpc("restore_page", { target_page: id });
}

export async function deletePageForever(id: string) {
  return callPageRpc("delete_page_forever", { target_page: id });
}
