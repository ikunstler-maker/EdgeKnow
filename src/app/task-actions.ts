"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { t } from "@/i18n";
import { dataClient, writeClient } from "@/lib/team-db/data";

// Tasks: every check (roles, fields, the workspace) is in the database
// functions; these forward the call to wherever the workspace keeps its data.

async function call<T extends object = object>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

export async function createTaskProject(ws: string, name: string, key: string, icon: string | null) {
  const s = t.tasks.defaultStatuses;
  return call<{ id: string; key: string }>("create_task_project", {
    ws,
    new_name: name,
    new_key: key,
    new_icon: icon,
    status_names: [s.todo, s.doing, s.done],
  });
}

export async function updateTaskProject(projectId: string, changes: Record<string, unknown>) {
  return call("update_task_project", { target_project: projectId, changes });
}

export async function setTaskProjectMemberRole(projectId: string, userId: string, role: string | null) {
  return call("set_task_project_member_role", { target_project: projectId, member: userId, new_role: role });
}

export async function setTaskProjectGroupRole(projectId: string, groupId: string, role: string | null) {
  return call("set_task_project_group_role", { target_project: projectId, target_group: groupId, new_role: role });
}

export async function createTask(projectId: string, fields: Record<string, unknown>) {
  return call<{ id: string; key: string; number: number }>("create_task", { target_project: projectId, fields });
}

export async function updateTask(taskId: string, changes: Record<string, unknown>) {
  return call("update_task", { target_task: taskId, changes });
}

export async function deleteTask(taskId: string, restore = false) {
  return call("delete_task", { target_task: taskId, restore });
}

export async function addTaskComment(taskId: string, body: string, mentions: string[]) {
  return call<{ id: string }>("add_task_comment", { target_task: taskId, body, mention_ids: mentions });
}

export async function editTaskComment(commentId: string, body: string | null, remove = false) {
  return call("edit_task_comment", { target_comment: commentId, new_body: body, remove });
}

// The description is saved often while typing; no page refresh for it.
export async function saveTaskDescription(taskId: string, description: unknown): Promise<ActionResult> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc("update_task", { target_task: taskId, changes: { description } });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult;
}

export async function projectRole(projectId: string): Promise<string | null> {
  const { data } = await (await dataClient()).rpc("task_project_role", { target_project: projectId });
  return (data as string | null) ?? null;
}
