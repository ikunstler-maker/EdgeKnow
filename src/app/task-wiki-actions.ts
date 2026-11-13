"use server";

import type { ActionResult } from "@/lib/action-result";
import { dataClient, writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";
import { getCurrentUser } from "@/lib/auth";
import { t } from "@/i18n";
import type { StatusCategory, TaskPriority, TaskStatus, TaskType } from "@/lib/tasks";

// Tasks inside wiki pages (step Z4): chips and lists read with the reader's own
// session, so RLS decides what shows; changes go through update_task's checks.

export type ChipTask = {
  id: string;
  key: string;
  projectKey: string;
  number: number;
  projectId: string;
  title: string;
  type: TaskType;
  status: string;
  category: StatusCategory;
  assignee: string | null;
  assigneeId: string | null;
  deleted: boolean;
  canEdit: boolean;
};

type Row = {
  id: string;
  number: number;
  title: string;
  type: TaskType;
  project_id: string;
  assignee_id: string | null;
  deleted_at: string | null;
  project: { key: string } | null;
  status: { name: string; category: StatusCategory } | null;
  assignee: { name: string | null; email: string } | null;
};
const CHIP_COLUMNS =
  "id, number, title, type, project_id, assignee_id, deleted_at, project:task_projects(key), status:task_statuses(name, category), assignee:profiles!tasks_assignee_id_fkey(name, email)";

async function editableProjects(db: Awaited<ReturnType<typeof dataClient>>, projectIds: string[]) {
  const roles = await Promise.all([...new Set(projectIds)].map(async (id) => [id, (await db.rpc("task_project_role", { target_project: id })).data as string | null] as const));
  return new Set(roles.filter(([, role]) => role === "owner" || role === "editor").map(([id]) => id));
}

function toChip(row: Row, editable: Set<string>): ChipTask {
  const projectKey = row.project?.key ?? "?";
  return {
    id: row.id,
    key: `${projectKey}-${row.number}`,
    projectKey,
    number: row.number,
    projectId: row.project_id,
    title: row.title,
    type: row.type,
    status: row.status?.name ?? "",
    category: row.status?.category ?? "todo",
    assignee: row.assignee ? row.assignee.name || row.assignee.email : null,
    assigneeId: row.assignee_id,
    deleted: row.deleted_at !== null,
    canEdit: editable.has(row.project_id) && row.deleted_at === null,
  };
}

// The tasks behind chips on a page; ones the reader can't see are simply missing.
export async function taskChips(shortId: string, ids: string[]): Promise<ChipTask[]> {
  const clean = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)))].slice(0, 200);
  if (!clean.length) return [];
  const db = await dataClient(shortId);
  const { data } = await db.from("tasks").select(CHIP_COLUMNS).in("id", clean).overrideTypes<Row[], { merge: false }>();
  const rows = data ?? [];
  const editable = await editableProjects(db, rows.map((r) => r.project_id));
  return rows.map((row) => toChip(row, editable));
}

export type ChipProject = { id: string; key: string; name: string; icon: string | null; canEdit: boolean };

// For "@": tasks by key ("MAR-12") or words of the title, and projects to create one in.
export async function searchTasksForChip(shortId: string, query: string): Promise<{ tasks: ChipTask[]; projects: ChipProject[] }> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { tasks: [], projects: [] };
  const db = await dataClient(shortId);
  const { data: projectRows } = await db.from("task_projects").select("id, key, name, icon").eq("workspace_id", workspace.id).is("archived_at", null).order("name");
  const projects = (projectRows ?? []) as Omit<ChipProject, "canEdit">[];
  const editable = await editableProjects(db, projects.map((p) => p.id));
  const text = query.trim();
  const byKey = text.toUpperCase().match(/^([A-Z][A-Z0-9]{1,9})-(\d{1,7})$/);
  let request = db.from("tasks").select(CHIP_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null);
  if (byKey) {
    const project = projects.find((p) => p.key === byKey[1]);
    request = request.eq("project_id", project?.id ?? "00000000-0000-0000-0000-000000000000").eq("number", Number(byKey[2]));
  } else if (text) {
    request = request.ilike("title", `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  const { data } = await request.order("updated_at", { ascending: false }).limit(8).overrideTypes<Row[], { merge: false }>();
  return { tasks: (data ?? []).map((row) => toChip(row, editable)), projects: projects.map((p) => ({ ...p, canEdit: editable.has(p.id) })) };
}

// A new task from the page (from "@" or from selected text); the description says where it came from.
export async function createTaskFromPage(shortId: string, projectId: string, title: string, pageId: string | null): Promise<ActionResult<{ id: string; key: string }>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const description = pageId
    ? [{ type: "paragraph", content: [{ type: "text", text: `${t.tasks.wiki.fromPage} `, styles: {} }, { type: "pageChip", props: { pageId } }] }]
    : undefined;
  const { data, error } = await db.rpc("create_task", { target_project: projectId, fields: { title: title.trim().slice(0, 300), ...(description ? { description } : {}) } });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult<{ id: string; key: string }>;
}

export async function projectStatuses(shortId: string, projectId: string): Promise<TaskStatus[]> {
  const db = await dataClient(shortId);
  const { data } = await db.from("task_statuses").select("id, name, category, position, wip_limit").eq("project_id", projectId).order("position");
  return (data ?? []) as TaskStatus[];
}

// A status change from a chip or an embedded list (no page refresh: the caller reloads its tasks).
export async function setTaskStatusFromPage(shortId: string, taskId: string, statusId: string): Promise<ActionResult> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("update_task", { target_task: taskId, changes: { status_id: statusId } });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult;
}

// An assignee change from a chip (in a chat message); update_task checks who may assign whom.
export async function setTaskAssigneeFromChip(shortId: string, taskId: string, assigneeId: string | null): Promise<ActionResult> {
  if (assigneeId !== null && !/^[0-9a-f-]{36}$/.test(assigneeId)) return { ok: false, error: "unknown" };
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc("update_task", { target_task: taskId, changes: { assignee_id: assigneeId } });
  if (error || !data) return { ok: false, error: "unknown" };
  return data as ActionResult;
}

export type EmbedTask = { id: string; number: number; title: string; type: TaskType; priority: TaskPriority; status_id: string; assignee_id: string | null; position: number };
export type TaskEmbed = {
  project: { id: string; key: string; name: string; icon: string | null };
  statuses: TaskStatus[];
  tasks: EmbedTask[];
  total: number;
  canEdit: boolean;
  me: string | null;
};

// A project's tasks for a list or board on a page (up to 100; "only mine" optional).
export async function taskEmbed(shortId: string, projectId: string, onlyMine: boolean): Promise<TaskEmbed | null> {
  if (!/^[0-9a-f-]{36}$/.test(projectId)) return null;
  const db = await dataClient(shortId);
  const [{ data: project }, { data: role }, user] = await Promise.all([
    db.from("task_projects").select("id, key, name, icon").eq("id", projectId).maybeSingle(),
    db.rpc("task_project_role", { target_project: projectId }),
    getCurrentUser(),
  ]);
  if (!project || !role) return null;
  const me = user?.id ?? null;
  let request = db
    .from("tasks")
    .select("id, number, title, type, priority, status_id, assignee_id, position", { count: "exact" })
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (onlyMine && me) request = request.eq("assignee_id", me);
  const [{ data: tasks, count }, statuses] = await Promise.all([request.order("position").order("number").limit(100), projectStatuses(shortId, projectId)]);
  return {
    project: project as TaskEmbed["project"],
    statuses,
    tasks: (tasks ?? []) as EmbedTask[],
    total: count ?? 0,
    canEdit: role === "owner" || role === "editor",
    me,
  };
}

export async function projectsForEmbed(shortId: string): Promise<ChipProject[]> {
  return (await searchTasksForChip(shortId, "")).projects;
}
