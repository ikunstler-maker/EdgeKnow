import "server-only";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, type Workspace } from "@/lib/workspace";
import type { Person, ProjectRole, TaskStatus } from "@/lib/tasks";

// A project by its key, with what every task screen needs: columns, the
// person's role and the workspace's members (for assignees). Reads go to
// wherever the workspace keeps its data, so RLS decides what shows.
export type ProjectView = {
  workspace: Workspace;
  project: { id: string; key: string; name: string; icon: string | null; workspace_role: string | null; sprints: boolean };
  statuses: TaskStatus[];
  role: ProjectRole;
  members: Person[];
};

export async function loadProject(shortId: string, key: string): Promise<ProjectView | null> {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return null;
  const db = await dataClient(shortId);
  const { data: project } = await db
    .from("task_projects")
    .select("id, key, name, icon, workspace_role, sprints")
    .eq("workspace_id", workspace.id)
    .eq("key", key.toUpperCase())
    .maybeSingle();
  if (!project) return null;
  const [{ data: statuses }, { data: role }, { data: members }] = await Promise.all([
    db.from("task_statuses").select("id, name, category, position, wip_limit").eq("project_id", project.id).order("position"),
    db.rpc("task_project_role", { target_project: project.id }),
    db
      .from("workspace_members")
      .select("user_id, profile:profiles!workspace_members_user_id_fkey(name, email)")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .overrideTypes<{ user_id: string; profile: { name: string | null; email: string } | null }[], { merge: false }>(),
  ]);
  if (!role) return null;
  return {
    workspace,
    project,
    statuses: (statuses ?? []) as TaskStatus[],
    role: role as ProjectRole,
    members: (members ?? [])
      .filter((m) => m.profile)
      .map((m) => ({ id: m.user_id, name: m.profile!.name, email: m.profile!.email }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
  };
}

export const canEdit = (role: ProjectRole) => role === "owner" || role === "editor";
export const canComment = (role: ProjectRole) => role !== "viewer";
