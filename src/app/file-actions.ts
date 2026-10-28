"use server";

import { workspaceData } from "@/lib/team-db/data";

export type RegisteredAttachment =
  | { ok: true; path: string; backend: "supabase" | "drive" | "team" }
  | { ok: false; error: string };

// Registers an image before it is uploaded. The workspace's database checks
// rights, type, size and the quota and picks the path; for a team workspace
// (path C) the bytes then go to the team's own storage through our server.
export async function registerAttachment(input: {
  pageId: string;
  type: string;
  bytes: number;
  width: number;
  height: number;
}): Promise<RegisteredAttachment> {
  const data = await workspaceData();
  if (data?.location === "setup") return { ok: false, error: "team_setup" };
  const supabase = data?.client;
  if (!supabase) return { ok: false, error: "forbidden" };
  const { data: result, error } = await supabase.rpc("register_attachment", {
    target_page: input.pageId,
    file_type: input.type,
    file_bytes: input.bytes,
    file_width: input.width,
    file_height: input.height,
  });
  const registered = result as { ok: boolean; error?: string; path?: string; backend?: "supabase" | "drive" } | null;
  if (error || !registered?.ok || !registered.path) return { ok: false, error: registered?.error ?? "unknown" };
  return { ok: true, path: registered.path, backend: data.location === "team" ? "team" : (registered.backend ?? "supabase") };
}
