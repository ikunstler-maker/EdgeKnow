import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The workspace's owner or an admin, acting on one of its members.
export async function workspaceAdminFor(ws: string, member: string) {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!admin || !/^[0-9a-f-]{36}$/.test(ws) || !/^[0-9a-f-]{36}$/.test(member)) return null;
  const [{ data: role }, { data: claims }] = await Promise.all([supabase.rpc("workspace_role", { ws }), supabase.auth.getClaims()]);
  if (role !== "owner" && role !== "admin") return null;
  const { data: target } = await admin.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", member).maybeSingle();
  if (!target) return null;
  return { admin, actor: (claims?.claims?.sub as string) ?? null };
}
