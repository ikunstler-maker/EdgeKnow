"use server";

import type { ActionResult } from "@/lib/action-result";
import { workspaceAdminFor } from "@/lib/drive/member-access";
import { memberFilesOverview, moveMemberFiles, type MemberDestination, type MemberFilesOverview } from "@/lib/drive/member-files";

// Before someone is removed from a workspace: their task files on their own
// Google Drive, and copying them. Owner and admins only.


export async function getMemberFiles(ws: string, member: string): Promise<ActionResult<{ overview: MemberFilesOverview }>> {
  const access = await workspaceAdminFor(ws, member);
  if (!access) return { ok: false, error: "forbidden" };
  return { ok: true, overview: await memberFilesOverview(access.admin, ws, member) };
}

export async function copyMemberFiles(ws: string, member: string, to: MemberDestination): Promise<ActionResult<{ moved: number; failed: number; remaining: number }>> {
  if (!["wiki", "edgeknow", "project"].includes(to)) return { ok: false, error: "invalid" };
  const access = await workspaceAdminFor(ws, member);
  if (!access) return { ok: false, error: "forbidden" };
  const result = await moveMemberFiles(access.admin, ws, member, to);
  if (result.moved) {
    await access.admin.from("audit_log").insert({ workspace_id: ws, actor_id: access.actor, action: "member_files_copied", details: { member, to, moved: result.moved } });
  }
  return { ok: true, ...result };
}
