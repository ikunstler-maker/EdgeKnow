"use server";

import { withPaths } from "@/lib/groups";
import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import type { NotificationKind, NotificationList, TaskRule, TaskRuleInput } from "@/lib/notifications";

// Notifications and task rules: the database decides who hears what and what
// they may still see; these forward the calls to wherever the workspace keeps its data.
// No page re-render here: the bell polls, and rules refresh their own dialog.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await writeClient(shortId);
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<T>;
}

export async function loadNotifications(shortId: string, workspaceId: string): Promise<NotificationList | null> {
  const supabase = await dataClient(shortId);
  // Reminders run on no clock: the bell asking for news is what makes the ones that are due
  // (an older database has no such function yet — then there are simply none).
  const writer = await writeClient(shortId);
  if (writer) {
    await writer.rpc("calendar_remind_me", { ws: workspaceId });
    // Chat messages planned for later whose time has come go out with the same check.
    await writer.rpc("chat_send_due", { ws: workspaceId });
  }
  const { data, error } = await supabase.rpc("my_notifications", { ws: workspaceId, max_rows: 40 });
  if (error || !data) return null;
  return data as NotificationList;
}

export async function markNotificationsRead(shortId: string, workspaceId: string, ids: string[] | null) {
  return call(shortId, "mark_notifications_read", { ws: workspaceId, ids });
}

export async function loadNotificationPrefs(shortId: string, workspaceId: string): Promise<NotificationKind[]> {
  const supabase = await dataClient(shortId);
  const { data } = await supabase.from("notification_prefs").select("muted").eq("workspace_id", workspaceId).maybeSingle();
  return ((data?.muted as NotificationKind[] | undefined) ?? []);
}

export async function setNotificationPrefs(shortId: string, workspaceId: string, muted: NotificationKind[]) {
  return call(shortId, "set_notification_prefs", { ws: workspaceId, new_muted: muted });
}

export async function saveTaskRule(shortId: string, projectId: string, rule: TaskRuleInput) {
  return call<{ id: string }>(shortId, "save_task_rule", { target_project: projectId, rule });
}

export async function deleteTaskRule(shortId: string, ruleId: string) {
  return call(shortId, "delete_task_rule", { target_rule: ruleId });
}

export async function loadTaskRules(shortId: string, projectId: string, workspaceId: string) {
  const supabase = await dataClient(shortId);
  const [{ data: rules }, { data: groups }] = await Promise.all([
    supabase.from("task_rules").select("id, event, category, status_id, notify_roles, notify_users, notify_groups, move_to_status").eq("project_id", projectId).order("created_at"),
    supabase.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspaceId).order("name"),
  ]);
  return { rules: (rules ?? []) as TaskRule[], groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]) };
}
