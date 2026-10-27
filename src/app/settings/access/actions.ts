"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Permission checks and audit logging live in the database functions, so these
// actions stay thin: anyone can call them, only admins get past the RPC.
async function callAdminRpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/settings/access");
  return data as ActionResult;
}

export async function addDomain(formData: FormData) {
  return callAdminRpc("admin_add_domain", { new_domain: String(formData.get("domain") ?? "") });
}

export async function setDomainActive(domain: string, active: boolean) {
  return callAdminRpc("admin_set_domain_active", { target_domain: domain, active });
}

export async function removeDomain(domain: string) {
  return callAdminRpc("admin_remove_domain", { target_domain: domain });
}
