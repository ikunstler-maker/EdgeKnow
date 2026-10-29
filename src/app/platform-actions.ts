"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

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
