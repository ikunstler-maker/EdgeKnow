import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataClient } from "@/lib/team-db/data";

// Who may connect a Drive for task files: anyone in the workspace their own
// ("personal"); those who manage the project for the project ("project").
// Checked by the databases with the person's own session.
export async function mayConnectTaskDrive(workspaceId: string, purpose: "personal" | "project", projectId: string | null) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  const admin = createAdminClient();
  if (!userId || !admin || !/^[0-9a-f-]{36}$/.test(workspaceId)) return null;
  const { data: role } = await supabase.rpc("workspace_role", { ws: workspaceId });
  if (!role) return null;
  const { data: workspace } = await admin.from("workspaces").select("name, short_id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return null;
  if (purpose === "personal") return { userId, workspace, projectName: null as string | null };
  if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) return null;
  const db = await dataClient(workspace.short_id);
  const [{ data: projectRole }, { data: project }] = await Promise.all([
    db.rpc("task_project_role", { target_project: projectId }),
    db.from("task_projects").select("name, workspace_id").eq("id", projectId).maybeSingle(),
  ]);
  if (projectRole !== "owner" || project?.workspace_id !== workspaceId) return null;
  return { userId, workspace, projectName: project.name as string };
}

// Only paths inside the site, for sending the person back.
export const safeBack = (value: string | null | undefined) => (value && /^\/w\/[a-z0-9]{8}\//.test(value) && !value.includes("//", 1) ? value : null);
