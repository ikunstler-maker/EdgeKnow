"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Who sees the person's statistics in this workspace: only them, or every member.
export async function setProfileVisibility(ws: string, visibility: "private" | "workspace") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_profile_visibility", { ws, visibility });
  if (error || !data?.ok) return { ok: false as const };
  revalidatePath("/w/[wid]/profile", "page");
  return { ok: true as const };
}
