"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { t } from "@/i18n";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { openChecklistItems, parseTaskKey, type SidebarBoard, type SidebarTask, type StatusCategory, type TaskPriority } from "@/lib/tasks";
import type { TaskTemplate, TemplateData } from "@/lib/task-templates";

// Tasks: every check (roles, fields, the workspace) is in the database
// functions; these forward the call to wherever the workspace keeps its data.

async function call<T extends object = object>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await writeClient();
  if (!supabase) return { ok: false, error: "team_setup" };
  const { data, error } = await supabase.rpc(fn, args);
  // A column's own limits (who may take a task out, who may put one in) are refused by the database.
  const gate = error?.message?.match(/column_(take|put)_forbidden/)?.[0];
  if (gate) return { ok: false, error: gate };
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

// A column's status button (short name, colour) and who may move tasks out of and into it.
export async function setColumnOptions(statusId: string, options: { short_name?: string; color?: string | null; take_groups?: string[]; put_groups?: string[] }) {
  return call("set_column_options", { target_status: statusId, options });
}

// The tracker's people of a project (seats) with how many tasks each holds and wrote: for
// the project's owner and workspace admins; anyone else gets an empty list.
export type ImportPersonRow = { id: string; name: string; email: string | null; tracker_roles: string[]; project_role: string | null; user_id: string | null; assigned: number; reported: number };
export async function listImportPeople(projectId: string): Promise<ImportPersonRow[]> {
  const supabase = await writeClient();
  if (!supabase) return [];
  const { data } = await supabase.rpc("list_import_people", { target_project: projectId });
  return Array.isArray(data) ? (data as ImportPersonRow[]) : [];
}

// Seat a tracker person on a member (null frees the seat): their tasks follow.
export async function seatImportPerson(personId: string, memberId: string | null) {
  return call<{ assigned: number; reported: number }>("seat_import_person", { target_person: personId, member: memberId });
}

// Time spent on a task: a new entry (entryId null) or a change of one.
export async function saveTaskTime(taskId: string, entryId: string | null, minutes: number, date: string, note: string) {
  return call<{ id: string }>("save_task_time", { target_task: taskId, target_entry: entryId, spent_minutes: Math.round(minutes), spent_date: date, new_note: note });
}

export async function deleteTaskTime(entryId: string) {
  return call("delete_task_time", { target_entry: entryId });
}

// The project's owner: time tracking on or off, and who sees the entries.
export async function setProjectTimeTracking(projectId: string, enabled: boolean, visibility: string) {
  return call("set_project_time_tracking", { target_project: projectId, enabled, visibility });
}

export type TimeReportRow = { user_id: string | null; name: string; minutes: number; tasks: number };
export async function projectTimeReport(projectId: string, from: string | null, to: string | null): Promise<TimeReportRow[]> {
  const supabase = await writeClient();
  if (!supabase) return [];
  const { data } = await supabase.rpc("project_time_report", { target_project: projectId, date_from: from, date_to: to });
  return Array.isArray(data) ? (data as TimeReportRow[]) : [];
}

// A workspace admin sets the project's largest attachment and largest ZIP archive (MB).
export async function setProjectFileLimits(projectId: string, fileMb: number, zipMb: number) {
  return call("set_project_file_limits", { target_project: projectId, file_mb: Math.round(fileMb), zip_mb: Math.round(zipMb) });
}

// How a task repeats ({every, unit, weekdays, start, until}); null stops it.
export type RecurrenceRule = { every: number; unit: "day" | "week" | "month" | "year"; weekdays: number[]; start: string | null; until: string | null };
export async function setTaskRecurrence(taskId: string, rule: RecurrenceRule | null) {
  return call<{ next_on?: string }>("set_task_recurrence", { target_task: taskId, rule });
}

// The project's own permissions: who may do each action ({} rows: the usual rules).
export type PermissionRow = { action: string; roles: string[]; groups: string[]; members: string[]; reporter: boolean; assignee: boolean };
export async function loadTaskPermissions(projectId: string): Promise<PermissionRow[]> {
  const supabase = await writeClient();
  if (!supabase) return [];
  const { data } = await supabase.from("task_permissions").select("action, roles, groups, members, reporter, assignee").eq("project_id", projectId);
  return (data ?? []) as PermissionRow[];
}

// Who may do an action; null: back to the usual rule.
export async function setTaskPermission(projectId: string, action: string, holders: Omit<PermissionRow, "action"> | null) {
  return call("set_task_permission", { target_project: projectId, wanted: action, holders });
}

// A link kept with a task next to its files.
export async function addTaskWebLink(taskId: string, title: string, url: string) {
  return call<{ id: string }>("add_task_web_link", { target_task: taskId, new_title: title, new_url: url.trim() });
}

export async function deleteTaskWebLink(linkId: string) {
  return call("delete_task_web_link", { target_link: linkId });
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

export async function saveTaskField(projectId: string, fieldId: string | null, definition: Record<string, unknown>) {
  return call<{ id: string }>("save_task_field", { target_project: projectId, field_id: fieldId, definition });
}

// A copy of a field, right after it.
export async function copyTaskField(fieldId: string, name: string) {
  return call<{ id: string }>("copy_task_field", { target_field: fieldId, new_name: name.slice(0, 60) });
}

export async function deleteTaskField(fieldId: string) {
  return call("delete_task_field", { target_field: fieldId });
}

export async function saveTaskStatus(projectId: string, statusId: string | null, name: string, category: string, wipLimit: number | null, position: number | null) {
  return call<{ id: string }>("save_task_status", {
    target_project: projectId,
    target_status: statusId,
    new_name: name,
    new_category: category,
    new_wip_limit: wipLimit,
    new_position: position,
  });
}

export async function deleteTaskStatus(statusId: string, moveTo: string | null) {
  return call("delete_task_status", { target_status: statusId, move_to: moveTo });
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

// Step Z3: links, bulk changes, checklist → subtasks.

// Link this task with another one by its key ("MKT-12"). "blocked_by" turns the link round.
export async function addTaskLink(taskId: string, otherKey: string, kind: "blocks" | "blocked_by" | "relates" | "duplicates") {
  const parsed = parseTaskKey(otherKey);
  if (!parsed) return { ok: false, error: "task_not_found" } as ActionResult;
  const db = await dataClient();
  const { data: task } = await db.from("tasks").select("workspace_id").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "forbidden" } as ActionResult;
  const { data: project } = await db.from("task_projects").select("id").eq("workspace_id", task.workspace_id).eq("key", parsed[0]).maybeSingle();
  const { data: other } = project
    ? await db.from("tasks").select("id").eq("project_id", project.id).eq("number", parsed[1]).maybeSingle()
    : { data: null };
  if (!other) return { ok: false, error: "task_not_found" } as ActionResult;
  return kind === "blocked_by"
    ? call("add_task_link", { source_task: other.id, target_task: taskId, link_kind: "blocks" })
    : call("add_task_link", { source_task: taskId, target_task: other.id, link_kind: kind });
}

export async function deleteTaskLink(linkId: string) {
  return call("delete_task_link", { target_link: linkId });
}

export async function bulkUpdateTasks(taskIds: string[], changes: Record<string, unknown>) {
  return call<{ changed: number }>("bulk_update_tasks", { target_tasks: taskIds, changes });
}

// The description's unchecked checklist items become subtasks (once: same titles are skipped).
export async function checklistToSubtasks(taskId: string): Promise<ActionResult<{ created: number }>> {
  const db = await dataClient();
  const { data: task } = await db.from("tasks").select("id, project_id, description").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "forbidden" };
  const { data: children } = await db.from("tasks").select("title").eq("parent_id", taskId).is("deleted_at", null);
  const existing = new Set((children ?? []).map((c) => (c.title as string).toLowerCase()));
  const titles = [...new Set(openChecklistItems(task.description))].filter((title) => !existing.has(title.toLowerCase())).slice(0, 50);
  let created = 0;
  for (const title of titles) {
    const result = await call("create_task", { target_project: task.project_id, fields: { title, parent_id: taskId } });
    if (!result.ok) return created ? { ok: true, created } : result;
    created += 1;
  }
  return { ok: true, created };
}

// Private tasks (package 10): the author makes a task private or publishes it;
// whoever may edit it sets its co-assignees and the responsible.
export async function setTaskPrivate(taskId: string, makePrivate: boolean) {
  return call("set_task_private", { target: taskId, make_private: makePrivate });
}

export async function setTaskParticipants(taskId: string, people: { user_id: string; role: "co_assignee" | "responsible" }[]) {
  return call("set_task_participants", { target: taskId, people });
}

// Boards per team (package 11): a task stands on several boards, each in its own column;
// the project owner manages boards, who may open them and which columns freeze.
export async function saveTaskBoard(projectId: string, boardId: string | null, name: string, groupId: string | null, extraGroups: string[] = []) {
  return call<{ id: string }>("save_task_board", { target_project: projectId, target_board: boardId, new_name: name, team: groupId, extra_groups: extraGroups });
}

export async function deleteTaskBoard(boardId: string, moveTo: string) {
  return call("delete_task_board", { target_board: boardId, move_to: moveTo });
}

export async function addColumnOnBoard(projectId: string, boardId: string | null, name: string) {
  const saved = await call<{ id: string }>("save_task_status", {
    target_project: projectId,
    target_status: null,
    new_name: name,
    new_category: "doing",
    new_wip_limit: null,
    new_position: null,
  });
  if (!saved.ok || !boardId) return saved;
  return call("set_task_status_board", { target_status: saved.id, target_board: boardId, freezing: false });
}

export async function setColumnFreezes(statusId: string, boardId: string | null, freezes: boolean) {
  return call("set_task_status_board", { target_status: statusId, target_board: boardId, freezing: freezes });
}

export async function moveTaskOnBoard(taskId: string, columnId: string) {
  return call("move_task_on_board", { target: taskId, column_id: columnId });
}

export async function setFrozenMovesAdmin(projectId: string, adminOnly: boolean) {
  return call("set_frozen_moves_admin", { target_project: projectId, admin_only: adminOnly });
}

// Task templates: the project's and one's own (the database shows nobody else's).
export async function loadTaskTemplates(projectId: string): Promise<TaskTemplate[]> {
  const { data } = await (await dataClient())
    .from("task_templates")
    .select("id, owner_id, name, data, is_default")
    .eq("project_id", projectId)
    .order("name");
  return (data ?? []) as TaskTemplate[];
}

export async function saveTaskTemplate(projectId: string, templateId: string | null, personal: boolean, name: string, data: TemplateData, makeDefault: boolean) {
  return call<{ id: string }>("save_task_template", {
    target_project: projectId,
    target: templateId,
    personal,
    new_name: name,
    new_data: data,
    make_default: makeDefault,
  });
}

export async function deleteTaskTemplate(templateId: string) {
  return call("delete_task_template", { target: templateId });
}

// The side panel's tree: a project's boards and the tasks standing on each, in the order
// of the board (column by column). Read with the reader's own access; a task frozen for
// this person on a board is not listed there.
const TREE_LIMIT = 50;
export async function sidebarProjectTasks(projectId: string): Promise<SidebarBoard[]> {
  const db = await dataClient();
  type Row = { id: string; number: number; title: string; priority: TaskPriority; status_id: string; position: number };
  const columns = "id, number, title, priority, status_id, position";
  const [fast, { data: statusRows }] = await Promise.all([
    db.rpc("project_tasks", { target_project: projectId }).select(columns).is("deleted_at", null),
    db.from("task_statuses").select("id, name, category, position, board_id").eq("project_id", projectId),
  ]);
  // Where the function isn't there yet, the same rows come from the table.
  const tasks = ((fast.error?.code === "PGRST202" ? (await db.from("tasks").select(columns).eq("project_id", projectId).is("deleted_at", null)).data : fast.data) ?? []) as Row[];
  const statuses = (statusRows ?? []) as { id: string; name: string; category: StatusCategory; position: number; board_id: string | null }[];
  if (!tasks.length || !statuses.length) return [];
  const { data: placementRows } = await db.from("task_placements").select("task_id, board_id, status_id").in("status_id", statuses.map((x) => x.id));
  const placements = (placementRows ?? []) as { task_id: string; board_id: string | null; status_id: string }[];
  const statusOf = new Map(statuses.map((x) => [x.id, x]));
  const taskOf = new Map(tasks.map((x) => [x.id, x]));
  // Without placements (an older database) every task stands on the main board in its own column.
  const places = placements.length ? placements : tasks.map((x) => ({ task_id: x.id, board_id: statusOf.get(x.status_id)?.board_id ?? null, status_id: x.status_id }));
  const boards = new Map<string | null, SidebarTask[]>();
  for (const place of places) {
    const task = taskOf.get(place.task_id);
    const status = statusOf.get(place.status_id);
    if (!task || !status) continue;
    const list = boards.get(place.board_id ?? null) ?? [];
    list.push({ number: task.number, title: task.title, priority: task.priority, category: status.category, status: status.name, order: status.position * 1e9 + task.position });
    boards.set(place.board_id ?? null, list);
  }
  return [...boards].map(([id, list]) => {
    const sorted = list.sort((a, b) => a.order - b.order || a.number - b.number);
    return { id, tasks: sorted.slice(0, TREE_LIMIT), more: Math.max(0, sorted.length - TREE_LIMIT) };
  });
}
