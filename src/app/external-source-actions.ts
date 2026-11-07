"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { encrypt } from "@/lib/drive/secret-box";
import { LANG, SOURCE_COLUMNS, sourceUrl, syncSource, type ExternalSource } from "@/lib/external-source";
import { checkUrl } from "@/lib/link-preview";
import { overLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dataClient } from "@/lib/team-db/data";
import { getWorkspace, isWorkspaceAdmin } from "@/lib/workspace";

// Only workspace owners and admins connect, refresh or remove an external source.
// The key is encrypted here and never sent back to the browser.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function adminContext(shortId: string, pageId: string) {
  if (!UUID.test(pageId)) return null;
  const workspace = await getWorkspace(shortId);
  if (!workspace || !isWorkspaceAdmin(workspace)) return null;
  const { data: page } = await (await dataClient(shortId)).from("pages").select("id, workspace_id").eq("id", pageId).maybeSingle();
  if (!page || page.workspace_id !== workspace.id) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  return { workspace, admin };
}

async function sourceOf(admin: NonNullable<ReturnType<typeof createAdminClient>>, workspaceId: string, pageId: string) {
  const { data } = await admin.from("external_sources").select(SOURCE_COLUMNS).eq("page_id", pageId).eq("workspace_id", workspaceId).maybeSingle();
  return data as ExternalSource | null;
}

const cleanKey = (key: string) => key.trim().slice(0, 500);

// "uk, ru" → ["uk", "ru"]; several languages need {lang} in the address.
function parseLanguages(raw: string, url: string): string[] | null {
  const list = [...new Set(raw.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
  if (list.length > 5 || !list.every((l) => LANG.test(l))) return null;
  if (url.includes("{lang}") ? list.length === 0 : list.length > 1) return null;
  return list;
}

export async function connectExternalSource(
  shortId: string,
  pageId: string,
  rawUrl: string,
  key: string,
  rawLanguages = "",
): Promise<ActionResult> {
  if (await overLimit(await createClient(), "save")) return { ok: false, error: "rate_limited" };
  const ctx = await adminContext(shortId, pageId);
  if (!ctx) return { ok: false, error: "forbidden" };
  const address = rawUrl.trim();
  const languages = parseLanguages(rawLanguages, address);
  if (!languages) return { ok: false, error: "invalid_languages" };
  // The {lang} placeholder stays as typed; the check runs on a real address.
  const url = checkUrl(sourceUrl(address, languages[0]));
  if (!url || address.length > 2000 || !address.startsWith("https://")) return { ok: false, error: "invalid_url" };
  if (await sourceOf(ctx.admin, ctx.workspace.id, pageId)) return { ok: false, error: "already_connected" };
  const { data: user } = await (await createClient()).auth.getUser();
  const { data, error } = await ctx.admin
    .from("external_sources")
    .insert({
      workspace_id: ctx.workspace.id,
      page_id: pageId,
      url: address,
      languages,
      secret_encrypted: cleanKey(key) ? encrypt(cleanKey(key)) : null,
      created_by: user.user?.id ?? null,
    })
    .select(SOURCE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "unknown" };
  // The first fetch is the check: if it fails, nothing stays connected.
  const result = await syncSource(ctx.admin, data as ExternalSource, true);
  if (!result.ok) {
    await ctx.admin.from("external_sources").delete().eq("id", (data as ExternalSource).id);
    return result;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function refreshExternalSource(shortId: string, pageId: string): Promise<ActionResult> {
  const ctx = await adminContext(shortId, pageId);
  if (!ctx) return { ok: false, error: "forbidden" };
  const source = await sourceOf(ctx.admin, ctx.workspace.id, pageId);
  if (!source) return { ok: false, error: "not_connected" };
  const result = await syncSource(ctx.admin, source, true);
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : result;
}

export async function replaceExternalKey(shortId: string, pageId: string, key: string): Promise<ActionResult> {
  const ctx = await adminContext(shortId, pageId);
  if (!ctx) return { ok: false, error: "forbidden" };
  const source = await sourceOf(ctx.admin, ctx.workspace.id, pageId);
  if (!source) return { ok: false, error: "not_connected" };
  const secret = cleanKey(key) ? encrypt(cleanKey(key)) : null;
  await ctx.admin.from("external_sources").update({ secret_encrypted: secret }).eq("id", source.id);
  const result = await syncSource(ctx.admin, { ...source, secret_encrypted: secret }, true);
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : result;
}

// The page stays with its last copy and becomes an ordinary editable page.
export async function disconnectExternalSource(shortId: string, pageId: string): Promise<ActionResult> {
  const ctx = await adminContext(shortId, pageId);
  if (!ctx) return { ok: false, error: "forbidden" };
  await ctx.admin.from("external_sources").delete().eq("page_id", pageId).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
