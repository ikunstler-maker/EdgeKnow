import "server-only";

import { request } from "node:https";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/drive/secret-box";
import { checkUrl, safeLookup } from "@/lib/link-preview";
import { markdownToBlocks } from "@/lib/markdown-import";
import { teamAdmin } from "@/lib/team-db/files";
import { teamDatabase, teamReady } from "@/lib/team-db/sync";

// Wiki pages fed from another service's Markdown (decision 2026-12-31). The server
// fetches the address with the workspace's secret key, turns the text into blocks
// and writes them into the page. The key never leaves the server; it is sent only
// to the source's own origin (redirects to another origin are refused).

export type ExternalSource = {
  id: string;
  workspace_id: string;
  page_id: string;
  url: string;
  secret_encrypted: string | null;
  languages: string[];
  etag: string | null;
  last_modified: string | null;
  synced_at: string | null;
  last_error: string | null;
};

export const SOURCE_COLUMNS = "id, workspace_id, page_id, url, secret_encrypted, languages, etag, last_modified, synced_at, last_error";
export const REFRESH_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
export const MAX_TEXT = 2 * 1024 * 1024;
export const MAX_IMAGE = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type Fetched = { status: number; type: string; body: Buffer; etag?: string; lastModified?: string };

function fetchOnce(url: URL, headers: Record<string, string>, maxBytes: number) {
  return new Promise<Fetched & { location?: string }>((resolve, reject) => {
    const req = request(url, { method: "GET", lookup: safeLookup as never, timeout: TIMEOUT_MS, headers }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      const meta = { etag: res.headers.etag, lastModified: res.headers["last-modified"] };
      if ((status >= 300 && status < 400) || status >= 400 || status === 304) {
        res.resume();
        return resolve({ status, type, body: Buffer.alloc(0), location: res.headers.location, ...meta });
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) return res.destroy(Object.assign(new Error("too_large"), { code: "ETOOLARGE" }));
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks), ...meta }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

// Fetches from the source's origin with its key; null when the address is not allowed.
export async function fetchFromSource(
  source: Pick<ExternalSource, "url" | "secret_encrypted">,
  target: string,
  extra: Record<string, string>,
  maxBytes: number,
): Promise<Fetched | null> {
  const origin = checkUrl(sourceUrl(source.url, "xx"))?.origin;
  let url = checkUrl(target);
  if (!origin || !url || url.origin !== origin) return null;
  const headers: Record<string, string> = { "User-Agent": "EdgeKnowExternalPage/1.0", ...extra };
  if (source.secret_encrypted) headers.Authorization = `Bearer ${decrypt(source.secret_encrypted)}`;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(url, headers, maxBytes);
    if (!res.location) return res;
    const next = checkUrl(new URL(res.location, url).toString());
    // The key never follows a redirect to another site; a sign-in page is the usual reason.
    if (!next || next.origin !== origin) {
      const host = (() => {
        try {
          return new URL(res.location, url).hostname;
        } catch {
          return "";
        }
      })();
      const signIn = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com)$/.test(host) || /login|signin|sign-in|auth/i.test(res.location);
      throw Object.assign(new Error("redirect"), { code: signIn ? "ELOGIN" : "EOTHERSITE" });
    }
    url = next;
  }
  return null;
}

// The address of one language: {lang} is replaced; without it the URL is used as is.
export const sourceUrl = (url: string, lang?: string) => (lang ? url.replaceAll("{lang}", lang) : url);
export const LANG = /^[a-z]{2}$/;

export const imageProxyUrl = (sourceId: string, url: string) => `/api/external/${sourceId}/image?u=${encodeURIComponent(url)}`;

// Pictures on the source's own origin go through our proxy (they need the key);
// any other https picture is shown by link like other pictures in the wiki.
export function blocksFromMarkdown(source: Pick<ExternalSource, "id" | "url">, markdown: string) {
  const base = new URL(sourceUrl(source.url, "xx"));
  return markdownToBlocks(markdown, base, (raw) => {
    const url = checkUrl(new URL(raw, base).toString());
    if (!url) return null;
    return url.origin === base.origin ? imageProxyUrl(source.id, url.toString()) : url.toString();
  });
}

export function errorCode(error: unknown) {
  const code = (error as { code?: string; message?: string })?.code;
  if (code === "ETOOLARGE") return "too_large";
  if (code === "ELOGIN") return "login_required";
  if (code === "EOTHERSITE") return "redirect_other_site";
  if (code === "EBLOCKED") return "blocked_address";
  return "unreachable";
}

async function pageClient(admin: SupabaseClient, workspaceId: string) {
  const team = await teamDatabase(admin, workspaceId);
  if (team) return teamReady(team) ? teamAdmin(team) : null;
  return admin;
}

export type SyncResult = { ok: true; changed: boolean } | { ok: false; error: string };

// Fetches the source and writes it into its page. `markdown` lets a caller that
// already fetched (the connect check) skip the second request.
export async function syncSource(admin: SupabaseClient, source: ExternalSource, force = false): Promise<SyncResult> {
  const now = new Date().toISOString();
  const fail = async (error: string): Promise<SyncResult> => {
    await admin.from("external_sources").update({ last_error: error, synced_at: now }).eq("id", source.id);
    return { ok: false, error };
  };
  const langs = source.languages.length ? source.languages : [undefined];
  // Conditional requests only for a single address (several languages: always fetch).
  const conditional: Record<string, string> = {};
  if (!force && langs.length === 1 && source.etag) conditional["If-None-Match"] = source.etag;
  if (!force && langs.length === 1 && source.last_modified) conditional["If-Modified-Since"] = source.last_modified;

  const texts: (string | null)[] = [];
  let meta: Pick<Fetched, "etag" | "lastModified"> = {};
  for (const [index, lang] of langs.entries()) {
    let res: Fetched | null;
    try {
      res = await fetchFromSource(source, sourceUrl(source.url, lang), { Accept: "text/markdown, text/plain;q=0.9", ...conditional }, MAX_TEXT);
    } catch (error) {
      if (index === 0) return fail(errorCode(error));
      texts.push(null);
      continue;
    }
    if (index === 0) {
      if (!res) return fail("blocked_address");
      if (res.status === 304) {
        await admin.from("external_sources").update({ last_error: null, synced_at: now }).eq("id", source.id);
        return { ok: true, changed: false };
      }
      if (res.status === 401 || res.status === 403) return fail("unauthorized");
      if (res.status !== 200) return fail(`http_${res.status}`.slice(0, 20));
      if (!/^text\/(markdown|plain|x-markdown)/.test(res.type)) return fail("not_markdown");
      meta = res;
    }
    // A missing extra language is skipped: readers then see the main one.
    const ok = res && res.status === 200 && /^text\/(markdown|plain|x-markdown)/.test(res.type);
    texts.push(ok ? res!.body.toString("utf8") : null);
  }

  const db = await pageClient(admin, source.workspace_id);
  if (!db) return fail("team_setup");
  const content = blocksFromMarkdown(source, texts[0]!);
  const translations: Record<string, unknown> = {};
  langs.forEach((lang, i) => {
    if (i > 0 && lang && texts[i] !== null) translations[lang] = blocksFromMarkdown(source, texts[i]!);
  });
  const { data: page } = await db.from("pages").select("version").eq("id", source.page_id).maybeSingle();
  if (!page) return fail("page_missing");
  const { error } = await db
    .from("pages")
    .update({ content, version: (page as { version: number }).version + 1, updated_at: now })
    .eq("id", source.page_id)
    .eq("version", (page as { version: number }).version);
  if (error) return fail("save_failed");
  await admin
    .from("external_sources")
    .update({ translations, last_error: null, synced_at: now, etag: meta.etag ?? null, last_modified: meta.lastModified ?? null })
    .eq("id", source.id);
  return { ok: true, changed: true };
}

// Called when someone opens the page: refreshes at most once an hour. The
// conditional update claims the refresh so parallel visits fetch only once.
export async function refreshIfStale(admin: SupabaseClient, sourceId: string) {
  const cutoff = new Date(Date.now() - REFRESH_MS).toISOString();
  const { data } = await admin
    .from("external_sources")
    .update({ synced_at: new Date().toISOString() })
    .eq("id", sourceId)
    .or(`synced_at.is.null,synced_at.lt.${cutoff}`)
    .select(SOURCE_COLUMNS)
    .maybeSingle();
  if (data) await syncSource(admin, data as ExternalSource).catch(() => null);
}
