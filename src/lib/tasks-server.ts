import "server-only";
import { withPaths } from "@/lib/groups";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, type Workspace } from "@/lib/workspace";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockedTasks, type ColumnMoves, type LinkedTask, type Person, type ProjectRole, type TaskBoardInfo, type TaskField, type TaskLink, type TaskStatus } from "@/lib/tasks";

// A project by its key, with what every task screen needs: columns, the
// person's role and the workspace's members (for assignees). Reads go to
// wherever the workspace keeps its data, so RLS decides what shows.
export type ProjectView = {
  workspace: Workspace;
  project: { id: string; key: string; name: string; icon: string | null; workspace_role: string | null; sprints: boolean; card_fields: string[]; time_last_column?: boolean; frozen_moves_admin?: boolean };
  statuses: TaskStatus[];
  boards: TaskBoardInfo[];
  groups: { id: string; name: string }[];
  fields: TaskField[];
  // Columns this person may take tasks from / put them into (missing: no limits known).
  moves: ColumnMoves;
  role: ProjectRole;
  members: Person[];
};

export async function loadProject(shortId: string, key: string): Promise<ProjectView | null> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return null;
  const db = await dataClient(shortId);
  const { data: project } = await db
    .from("task_projects")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("key", key.toUpperCase())
    .maybeSingle();
  if (!project) return null;
  const [{ data: statuses }, { data: role }, { data: members }, { data: fields }, { data: boards }, { data: groups }] = await Promise.all([
    // Every column of the row: a database a step behind the site lacks the newest ones, and the board must still open.
    db.from("task_statuses").select("*").eq("project_id", project.id).order("position"),
    db.rpc("task_project_role", { target_project: project.id }),
    db
      .from("workspace_members")
      .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(name, email)")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; role: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
    db.from("task_fields").select("id, name, kind, options, required, task_types, position, hint").eq("project_id", project.id).order("position"),
    db.from("task_boards").select("id, name, group_id, position, access:task_board_access(group_id)").eq("project_id", project.id).order("position"),
    db.from("workspace_groups").select("id, name, parent_id").eq("workspace_id", workspace.id).order("name"),
  ]);
  if (!role) return null;
  const { data: moves } = await db.rpc("column_moves", { target_project: project.id });
  return {
    moves: (moves as ColumnMoves | null) ?? {},
    workspace,
    // card_fields may be missing while the board migration rolls out.
    project: { ...project, card_fields: project.card_fields ?? ["key", "type", "priority", "assignee", "due", "labels"] },
    statuses: (statuses ?? []) as TaskStatus[],
    // Missing while the boards migration rolls out.
    boards: ((boards ?? []) as unknown as (Omit<TaskBoardInfo, "access"> & { access: { group_id: string }[] | null })[]).map((b) => ({ ...b, access: (b.access ?? []).map((a) => a.group_id) })),
    groups: withPaths((groups ?? []) as { id: string; name: string; parent_id: string | null }[]),
    fields: (fields ?? []) as TaskField[],
    role: role as ProjectRole,
    members: (members ?? [])
      .filter((m) => m.profile)
      .map((m) => ({ id: m.user_id, name: m.profile!.name, email: m.profile!.email, guest: m.role === "guest" }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
  };
}

export const canEdit = (role: ProjectRole) => role === "owner" || role === "editor";
export const canComment = (role: ProjectRole) => role !== "viewer";

type OtherTask = { id: string; number: number; title: string; done_at: string | null; deleted_at: string | null; project: { key: string } | null };

// Tasks by id as the reader may see them; hidden ones come back without key and title.
export async function linkedTasks(db: SupabaseClient, ids: string[]): Promise<Map<string, LinkedTask>> {
  const result = new Map<string, LinkedTask>(ids.map((id) => [id, { id, key: null, title: null, done: null, deleted: false }]));
  if (!ids.length) return result;
  const { data } = await db
    .from("tasks")
    .select("id, number, title, done_at, deleted_at, project:task_projects(key)")
    .in("id", ids)
    .overrideTypes<OtherTask[], { merge: false }>();
  for (const task of data ?? []) {
    result.set(task.id, {
      id: task.id,
      key: task.project ? `${task.project.key}-${task.number}` : null,
      title: task.title,
      done: task.done_at !== null,
      deleted: task.deleted_at !== null,
    });
  }
  return result;
}

// "Blocks" links of the workspace and which of the given tasks are blocked now.
// Tasks in hand (`known`: id → done) need no second read.
export async function blockedIn(db: SupabaseClient, workspaceId: string, known: Map<string, boolean>) {
  const { data } = await db.from("task_links").select("id, source_id, target_id, kind").eq("workspace_id", workspaceId).eq("kind", "blocks");
  const links = ((data ?? []) as TaskLink[]).filter((l) => known.has(l.target_id));
  const others = [...new Set(links.map((l) => l.source_id).filter((id) => !known.has(id)))];
  const done = new Map(known);
  for (const [id, task] of await linkedTasks(db, others)) if (task.done !== null) done.set(id, task.done || task.deleted);
  return blockedTasks(links, done);
}
