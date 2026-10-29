"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { hasRecord } from "@/lib/domain-dns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { syncWorkspaceNow } from "@/lib/team-db/data";

// Domains proven through DNS. Asking and cancelling go straight to the database
// functions; the check needs the server (it looks up DNS) and the secret key to
// record the result.

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult<Record<string, unknown>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<Record<string, unknown>>;
}

export async function requestDomain(ws: string, domain: string) {
  return rpc("request_workspace_domain", { ws, new_domain: domain });
}

export async function cancelDomainRequest(ws: string, domain: string) {
  return rpc("cancel_workspace_domain_request", { ws, target_domain: domain });
}

export async function confirmDomainByHand(ws: string, domain: string) {
  return rpc("platform_confirm_domain", { ws, target_domain: domain });
}

export async function setEmailDomainProof(allowed: boolean) {
  return rpc("set_email_domain_proof", { allowed });
}

export async function verifyDomain(ws: string, domain: string): Promise<ActionResult> {
  const supabase = await createClient();
  const [{ data: claims }, { data: role }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("workspace_role", { ws }),
  ]);
  const userId = claims?.claims?.sub;
  const admin = createAdminClient();
  if (!userId || (role !== "owner" && role !== "admin") || !admin) return { ok: false, error: "forbidden" };
  const { data: claim } = await admin
    .from("workspace_domain_claims")
    .select("token")
    .eq("workspace_id", ws)
    .eq("domain", domain)
    .maybeSingle();
  if (!claim) return { ok: false, error: "not_found" };
  if (!(await hasRecord(domain, claim.token))) {
    await admin
      .from("workspace_domain_claims")
      .update({ checked_at: new Date().toISOString(), last_error: "record_not_found" })
      .eq("workspace_id", ws)
      .eq("domain", domain);
    revalidatePath("/", "layout");
    return { ok: false, error: "record_not_found" };
  }
  const { data, error } = await admin.rpc("confirm_workspace_domain", { ws, target_domain: domain, how: "dns", actor: userId });
  if (error || !data) return { ok: false, error: "unknown" };
  if ((data as ActionResult).ok) await syncWorkspaceNow(ws);
  revalidatePath("/", "layout");
  return data as ActionResult;
}
