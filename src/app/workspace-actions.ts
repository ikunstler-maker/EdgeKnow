"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { syncWorkspaceNow, writeClient } from "@/lib/team-db/data";

// Permission checks and audit logging live in the database functions; these
// actions forward the call and refresh the screens that show the result.
async function callWorkspaceRpc<T extends object = object>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  // A team database (path C) keeps a copy of the members: bring it up to date now.
  if ((data as ActionResult).ok && typeof args.ws === "string") await syncWorkspaceNow(args.ws);
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createWorkspace(name: string): Promise<ActionResult> {
  const result = await callWorkspaceRpc<{ short_id: string }>("create_workspace", { new_name: name });
  if (result.ok) redirect(workspacePath(result.short_id));
  return result;
}

export async function renameWorkspace(ws: string, name: string) {
  return callWorkspaceRpc("rename_workspace", { ws, new_name: name });
}

export async function transferOwnership(ws: string, newOwner: string) {
  return callWorkspaceRpc("transfer_workspace_ownership", { ws, new_owner: newOwner });
}

export async function deleteWorkspace(ws: string, confirmName: string): Promise<ActionResult> {
  const result = await callWorkspaceRpc("delete_workspace", { ws, confirm_name: confirmName });
  if (result.ok) redirect("/");
  return result;
}

export async function addDomain(ws: string, domain: string) {
  return callWorkspaceRpc("add_workspace_domain", { ws, new_domain: domain });
}

export async function setDomainActive(ws: string, domain: string, active: boolean) {
  return callWorkspaceRpc("set_workspace_domain_active", { ws, target_domain: domain, active });
}

export async function removeDomain(ws: string, domain: string) {
  return callWorkspaceRpc("remove_workspace_domain", { ws, target_domain: domain });
}

export async function inviteMember(ws: string, email: string, role: string) {
  return callWorkspaceRpc<{ token: string }>("invite_member", {
    ws,
    invitee_email: email,
    invitee_role: role,
  });
}

export async function revokeInvitation(ws: string, invitationId: string) {
  return callWorkspaceRpc("revoke_invitation", { ws, target_invitation: invitationId });
}

export async function setMemberRole(ws: string, member: string, role: string) {
  return callWorkspaceRpc("set_member_role", { ws, member, new_role: role });
}

export async function removeMember(ws: string, member: string) {
  return callWorkspaceRpc("remove_member", { ws, member });
}

export async function leaveWorkspace(ws: string, me: string): Promise<ActionResult> {
  const result = await callWorkspaceRpc("remove_member", { ws, member: me });
  if (result.ok) redirect("/");
  return result;
}

export async function setOpenRegistration(open: boolean) {
  return callWorkspaceRpc("set_open_registration", { open });
}

// Pages live where the workspace's data lives (possibly the team database).
export async function reassignMemberPages(ws: string, fromUser: string, toUser: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc("reassign_member_pages", { ws, from_user: fromUser, to_user: toUser });
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult;
}
