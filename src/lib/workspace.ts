import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export type Workspace = {
  id: string;
  shortId: string;
  name: string;
  role: WorkspaceRole;
  // From workspace_context(): whether the data lives in a team database, and when this
  // person joined. Unknown (undefined) when the older two-step lookup answered.
  hasTeamDatabase?: boolean;
  joinedAt?: string | null;
};

export type WorkspaceSummary = { id: string; shortId: string; name: string };

type WorkspaceRow = { id: string; short_id: string; name: string };

// Workspaces the current user is an active member of (RLS hides the rest).
export const listMyWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id, short_id, name")
    .order("created_at")
    .overrideTypes<WorkspaceRow[], { merge: false }>();
  return (data ?? []).map((w) => ({ id: w.id, shortId: w.short_id, name: w.name }));
});

// The workspace behind /w/<shortId>, or null when it doesn't exist or the user isn't a member.
export const getWorkspace = cache(async (shortId: string): Promise<Workspace | null> => {
  if (!/^[a-z0-9]{8}$/.test(shortId)) return null;
  const supabase = await createClient();
  // One call for the workspace, the role and where the data lives.
  const context = await supabase.rpc("workspace_context", { ws_short_id: shortId });
  if (!context.error) {
    const c = context.data as { id: string; short_id: string; name: string; role: WorkspaceRole; joined_at: string | null; team_database: boolean } | null;
    return c ? { id: c.id, shortId: c.short_id, name: c.name, role: c.role, hasTeamDatabase: c.team_database, joinedAt: c.joined_at } : null;
  }
  // The function isn't there yet (a new version of the site reaches the server a
  // moment before the database): the same answer in two steps.
  const { data } = await supabase
    .from("workspaces")
    .select("id, short_id, name")
    .eq("short_id", shortId)
    .maybeSingle()
    .overrideTypes<WorkspaceRow, { merge: false }>();
  if (!data) return null;
  const { data: role } = await supabase.rpc("workspace_role", { ws: data.id });
  if (!role) return null;
  return { id: data.id, shortId: data.short_id, name: data.name, role: role as WorkspaceRole };
});

export const isWorkspaceAdmin = (workspace: Workspace) =>
  workspace.role === "owner" || workspace.role === "admin";
