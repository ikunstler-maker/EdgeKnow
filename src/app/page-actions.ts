"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { GrantRole, PageRole } from "@/lib/pages";
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

// Sharing (stage 5). The database lets only the page owner change access.

export type SharingPerson = { user_id: string; name: string | null; email: string };
export type SharingEntry = SharingPerson & {
  role: GrantRole;
  own: boolean;
  own_role: GrantRole | null;
  inherited_from: string | null;
  inherited_title: string | null;
};
export type PageSharing = {
  my_role: PageRole;
  owner: SharingPerson;
  has_parent: boolean;
  inherit: boolean;
  workspace_role: GrantRole | null;
  inherited_workspace_role: GrantRole | null;
  entries: SharingEntry[];
  members: SharingPerson[];
};

export async function getPageSharing(id: string): Promise<ActionResult<PageSharing>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("page_sharing", { target_page: id });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<PageSharing>;
}

export async function setPageMemberRole(id: string, userId: string, role: GrantRole | null) {
  return callPageRpc("set_page_member_role", { target_page: id, member: userId, new_role: role });
}

export async function setPageWorkspaceRole(id: string, role: GrantRole | null) {
  return callPageRpc("set_page_workspace_role", { target_page: id, new_role: role });
}

export async function setPageInherit(id: string, inherit: boolean) {
  return callPageRpc("set_page_inherit", { target_page: id, new_inherit: inherit });
}

export async function transferPageOwnership(id: string, userId: string) {
  return callPageRpc("transfer_page_ownership", { target_page: id, new_owner: userId });
}
