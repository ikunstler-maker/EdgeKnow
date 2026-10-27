import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceRole = "owner" | "admin" | "member";

export type Workspace = {
  id: string;
  shortId: string;
  name: string;
  role: WorkspaceRole;
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
