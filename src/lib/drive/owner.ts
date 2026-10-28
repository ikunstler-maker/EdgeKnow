import "server-only";
import { createClient } from "@/lib/supabase/server";

// The signed-in person and whether they own the workspace (checked by the
// database with their own session).
export async function requireOwner(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || !/^[0-9a-f-]{36}$/.test(workspaceId)) return null;
  const { data: role } = await supabase.rpc("workspace_role", { ws: workspaceId });
  return role === "owner" ? { userId: String(userId), supabase } : null;
}
