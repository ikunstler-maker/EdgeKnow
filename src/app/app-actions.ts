"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { appData, cleanAppUrl, cleanLogoUrl, APP_LIMITS, type AppData } from "@/lib/apps";
import { fetchLinkPreview } from "@/lib/link-preview";
import { overLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { writeClient } from "@/lib/team-db/data";
import { getWorkspace } from "@/lib/workspace";

// Company apps (Obriy, step O-1): objects of the service "apps" in the shared objects
// table. Every right is checked in the database functions (only the workspace's owner
// and admins add and change apps); these check the link and forward the call.

async function call<T extends object = object>(shortId: string, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const db = await writeClient(shortId);
  if (!db) return { ok: false, error: "team_setup" };
  const { data, error } = await db.rpc(fn, args);
  if (error || !data) return { ok: false, error: "unknown" };
  revalidatePath("/", "layout");
  return data as ActionResult<T>;
}

function clean(input: AppData): AppData | null {
  const url = cleanAppUrl(input.url ?? "");
  if (!url) return null;
  return appData({ ...input, url, logo: cleanLogoUrl(input.logo) });
}

// The app's name, description and logo, read from its site (https only, through the
// same guarded reader as link cards). Empty fields when the site gives nothing.
export async function readAppLink(raw: string): Promise<ActionResult<{ url: string; title: string; description: string; logo: string }>> {
  const url = cleanAppUrl(raw);
  if (!url) return { ok: false, error: "invalid_url" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, error: "forbidden" };
  if (await overLimit(supabase, "preview")) return { ok: false, error: "rate_limited" };
  const preview = url.startsWith("https://") ? await fetchLinkPreview(url) : null;
  if (!preview) return { ok: false, error: "unreachable" };
  return {
    ok: true,
    url,
    title: (preview.siteName && preview.title.length > 60 ? preview.siteName : preview.title || preview.siteName).slice(0, APP_LIMITS.title),
    description: preview.description.slice(0, APP_LIMITS.description),
    logo: preview.icon || preview.image,
  };
}

export async function createApp(shortId: string, title: string, input: AppData) {
  const workspace = await getWorkspace(shortId);
  if (!workspace) return { ok: false, error: "forbidden" } as ActionResult<{ id: string }>;
  const data = clean(input);
  if (!data) return { ok: false, error: "invalid_url" } as ActionResult<{ id: string }>;
  return call<{ id: string }>(shortId, "create_service_object", {
    ws: workspace.id,
    target_service: "apps",
    new_kind: "app",
    new_title: title.trim().slice(0, APP_LIMITS.title),
    new_data: data,
  });
}

export async function saveApp(shortId: string, id: string, title: string, input: AppData, version: number) {
  const data = clean(input);
  if (!data) return { ok: false, error: "invalid_url" } as ActionResult<{ version: number }>;
  return call<{ version: number }>(shortId, "save_service_object", { target_object: id, new_title: title.trim().slice(0, APP_LIMITS.title), new_data: data, base_version: version });
}

export async function trashApp(shortId: string, id: string, restore = false) {
  return call(shortId, "trash_service_object", { target_object: id, restore });
}

export async function deleteAppForever(shortId: string, id: string) {
  return call(shortId, "delete_service_object_forever", { target_object: id });
}

export async function setAppWorkspaceRole(shortId: string, id: string, role: string | null) {
  return call(shortId, "set_service_object_workspace_role", { target_object: id, new_role: role });
}

export async function setAppMemberRole(shortId: string, id: string, member: string, role: string | null) {
  return call(shortId, "set_service_object_member_role", { target_object: id, member, new_role: role });
}

export async function setAppGroupRole(shortId: string, id: string, group: string, role: string | null) {
  return call(shortId, "set_service_object_group_role", { target_object: id, target_group: group, new_role: role });
}
