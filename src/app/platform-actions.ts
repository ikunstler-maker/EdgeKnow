"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rekeyTeamSecrets } from "@/lib/team-db/rekey";
import { getCurrentUser } from "@/lib/auth";

// The platform admin's switches; the database functions check who calls them.
async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult;
}

export async function setRequireTeamDatabase(required: boolean) {
  return rpc("set_require_team_database", { required });
}

export async function setCentralAllowed(ws: string, allowed: boolean) {
  return rpc("platform_set_central_allowed", { ws, allowed });
}

export async function freezeWorkspace(ws: string, frozen: boolean, reason: string | null) {
  return rpc("platform_freeze_workspace", { ws, frozen, reason });
}

// TEAM_DB_KEY: move the team databases' secrets onto it now, or back onto the old key.
export async function rekeyTeamDatabases(direction: "new" | "old"): Promise<ActionResult<{ changed: number; failed: number }>> {
  const user = await getCurrentUser();
  const admin = createAdminClient();
  if (!user.isPlatformAdmin || !admin) return { ok: false, error: "forbidden" };
  if (direction === "new" && (process.env.TEAM_DB_KEY ?? "").length < 24) return { ok: false, error: "no_team_key" };
  const result = await rekeyTeamSecrets(admin, direction);
  await admin.from("audit_log").insert({ workspace_id: null, actor_id: user.id, action: direction === "new" ? "team_secrets_rekeyed" : "team_secrets_rekeyed_back", details: result });
  revalidatePath("/admin");
  return { ok: true, ...result };
}
