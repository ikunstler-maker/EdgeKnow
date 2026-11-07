"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { workspacePath } from "@/lib/paths";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

// Groups of people: changes are copied to a team's own database right away (callWorkspaceRpc).
export async function createGroup(ws: string, name: string, parent: string | null = null) {
  return callWorkspaceRpc("create_workspace_group", parent ? { ws, new_name: name, parent } : { ws, new_name: name });
}

// Company structure, stage 3: a lead sees what is given to their unit and the units under it.
export async function setGroupLead(ws: string, groupId: string, userId: string, lead: boolean) {
  return callWorkspaceRpc("set_group_lead", { ws, target_group: groupId, member: userId, lead });
}

// Company structure: a unit goes inside another (or to the top level).
export async function moveGroup(ws: string, groupId: string, parent: string | null, position: number | null) {
  return callWorkspaceRpc("move_workspace_group", { ws, target_group: groupId, new_parent: parent, new_position: position });
}

export async function renameGroup(ws: string, groupId: string, name: string) {
  return callWorkspaceRpc("rename_workspace_group", { ws, target_group: groupId, new_name: name });
}

export async function deleteGroup(ws: string, groupId: string) {
  return callWorkspaceRpc("delete_workspace_group", { ws, target_group: groupId });
}

export async function setGroupMember(ws: string, groupId: string, userId: string, included: boolean) {
  return callWorkspaceRpc("set_workspace_group_member", { ws, target_group: groupId, member: userId, included });
}

// A guest may get an end date for their access (an ISO time, or null for none).
export async function inviteMember(ws: string, email: string, role: string, guestUntil: string | null = null) {
  return callWorkspaceRpc<{ token: string }>("invite_member", {
    ws,
    invitee_email: email,
    invitee_role: role,
    guest_until: role === "guest" ? guestUntil : null,
  });
}

export async function setGuestAccessUntil(ws: string, member: string, until: string | null) {
  return callWorkspaceRpc("set_guest_access_until", { ws, member, until });
}

export async function revokeInvitation(ws: string, invitationId: string) {
  return callWorkspaceRpc("revoke_invitation", { ws, target_invitation: invitationId });
}

export async function setMemberRole(ws: string, member: string, role: string) {
  return callWorkspaceRpc("set_member_role", { ws, member, new_role: role });
}

export async function removeMember(ws: string, member: string) {
  const result = await callWorkspaceRpc("remove_member", { ws, member });
  // Their own Drive no longer takes new task files here; files still on it stay
  // readable while the access lasts (and can be copied later).
  if (result.ok) await createAdminClient()?.from("drive_accounts").update({ active: false }).eq("workspace_id", ws).eq("user_id", member).eq("purpose", "personal");
  return result;
}

export async function leaveWorkspace(ws: string, me: string): Promise<ActionResult> {
  const result = await callWorkspaceRpc("remove_member", { ws, member: me });
  if (result.ok) {
    await createAdminClient()?.from("drive_accounts").update({ active: false }).eq("workspace_id", ws).eq("user_id", me).eq("purpose", "personal");
    redirect("/");
  }
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

// Whether the workspace's owner and admins see the contents of private tasks.
export async function setPrivateTasksAdmin(ws: string, allowed: boolean) {
  return callWorkspaceRpc("set_private_tasks_admin", { ws, allowed });
}

// Company structure, stage 2: workspace roles (the owner's). Copied to a team's database like members.
export async function saveRole(ws: string, roleId: string | null, name: string, permissions: Record<string, boolean>, contentLevel: string | null) {
  return callWorkspaceRpc("save_workspace_role", { ws, role_id: roleId, new_name: name, new_permissions: permissions, new_level: contentLevel });
}

export async function deleteRole(ws: string, roleId: string) {
  return callWorkspaceRpc("delete_workspace_role", { ws, role_id: roleId });
}

export async function setMemberCustomRole(ws: string, userId: string, roleId: string | null) {
  return callWorkspaceRpc("set_member_custom_role", { ws, member: userId, role_id: roleId });
}
