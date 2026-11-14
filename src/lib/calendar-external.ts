import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { busyFromCalendar, normalizeCalendarUrl, type BusySlotInput } from "@/lib/calendar-external-parse";
import { calendarKeyConfigured, decrypt, encryptCalendar } from "@/lib/drive/secret-box";
import { fetchFromSource } from "@/lib/external-source";
import { GoogleCalendarError, googleCalendarConfigured, listOwnEvents } from "@/lib/google-calendar";
import { checkUrl } from "@/lib/link-preview";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamAdmin } from "@/lib/team-db/files";
import { teamDatabase, teamReady } from "@/lib/team-db/sync";

// Doba, phase 3b: busy time from a person's outside calendar (decision 2027-01-31).
// The address is a secret: encrypted with CALENDAR_TOKEN_KEY, kept in the central
// database only, never sent back to the browser, never logged. From the file only
// starts and ends are taken (src/lib/calendar-external-parse.ts) and written where
// the workspace keeps its data.
// DOBA-1 (phase 3c): a connection may instead be a sign-in with the provider; then the
// person's own events are read with their titles (shown to them alone) and whether they
// make them busy. The sign-in's own parts (connecting, the "Doba" calendar, video
// meetings, disconnecting) are in src/lib/calendar-google.ts.

export const EXTERNAL_REFRESH_MS = 60 * 60 * 1000;
// "Refresh now" and a failing address are not tried more often than this.
const RETRY_MS = 60 * 1000;
export const EXTERNAL_DAYS = 90;
const MAX_FILE = 2 * 1024 * 1024;
export const COLUMNS = "workspace_id, user_id, kind, url_encrypted, token_encrypted, account_email, doba_calendar_id, checked_at, synced_at, last_error, slots, pushed_at, push_error";

export type Connection = {
  workspace_id: string;
  user_id: string;
  kind: "feed" | "google";
  url_encrypted: string | null;
  token_encrypted: string | null;
  account_email: string | null;
  doba_calendar_id: string | null;
  checked_at: string | null;
  synced_at: string | null;
  last_error: string | null;
  slots: number;
  pushed_at: string | null;
  push_error: string | null;
};
// `google`: a sign-in with the provider can be offered; `kind`/`account`: what is connected
// (the account is the person's own, shown to them alone).
export type ConnectionState = {
  configured: boolean;
  google: boolean;
  connected: boolean;
  kind: "feed" | "google" | null;
  account: string | null;
  synced_at: string | null;
  error: string | null;
  push_error: string | null;
  slots: number;
};
const NOT_CONFIGURED: ConnectionState = { configured: false, google: false, connected: false, kind: null, account: null, synced_at: null, error: null, push_error: null, slots: 0 };

export const externalCalendarsConfigured = () => calendarKeyConfigured() && Boolean(process.env.SUPABASE_SECRET_KEY);

// For automated tests CALENDAR_FAKE_DIR stands in for the network: the last part of the
// address names a file there. Never on the real site.
const fakeDir = () => (process.env.VERCEL ? null : (process.env.CALENDAR_FAKE_DIR ?? null));

// The calendar file of an address; throws an error with a short code otherwise.
async function download(url: string): Promise<string> {
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const checked = checkUrl(url);
  if (!checked) throw fail("EBADURL");
  const fake = fakeDir();
  if (fake) {
    const name = checked.pathname.split("/").pop() ?? "";
    if (!/^[a-z0-9-]+\.ics$/.test(name)) throw fail("EHTTP");
    return readFile(join(fake, name), "utf8").catch(() => {
      throw fail("EHTTP");
    });
  }
  const res = await fetchFromSource({ url, secret_encrypted: null }, url, { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5", "User-Agent": "EdgeKnowCalendar/1.0" }, MAX_FILE);
  if (!res) throw fail("EBADURL");
  if (res.status === 401 || res.status === 403) throw fail("ELOGIN");
  if (res.status !== 200) throw fail("EHTTP");
  return res.body.toString("utf8");
}

// The short reason shown to the person (never the address or the server's message).
function reasonOf(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (error instanceof GoogleCalendarError) return error.revoked ? "revoked" : "unreachable";
  const known: Record<string, string> = { EBADURL: "bad_url", EBLOCKED: "bad_url", ELOGIN: "private", EOTHERSITE: "private", EHTTP: "unreachable", ETOOLARGE: "too_large", EPARSE: "not_calendar" };
  return known[code] ?? "unreachable";
}

async function readBusy(url: string): Promise<BusySlotInput[]> {
  const text = await download(url);
  try {
    const now = new Date();
    return busyFromCalendar(text, now, new Date(now.getTime() + EXTERNAL_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    throw Object.assign(new Error("not a calendar"), { code: "EPARSE" });
  }
}

// Where the workspace keeps its data, with the server's own key; null while a team
// database is being connected or handed back (nothing is written then).
export async function busyStore(admin: SupabaseClient, workspaceId: string): Promise<SupabaseClient | null> {
  const team = await teamDatabase(admin, workspaceId);
  if (!team) return admin;
  if (!teamReady(team) || team.return_step) return null;
  return teamAdmin(team);
}

export async function writeBusy(admin: SupabaseClient, workspaceId: string, userId: string, slots: (BusySlotInput & { title?: string; busy?: boolean })[]): Promise<number | null> {
  const store = await busyStore(admin, workspaceId);
  if (!store) return null;
  const { data, error } = await store.rpc("set_calendar_external_busy", { ws: workspaceId, person: userId, slots });
  return error ? null : Number(data ?? 0);
}

export const stateOf = (row: Connection | null): ConnectionState => ({
  configured: true,
  google: googleCalendarConfigured(),
  connected: Boolean(row),
  kind: row?.kind ?? null,
  account: row?.kind === "google" ? row.account_email : null,
  synced_at: row?.synced_at ?? null,
  error: row?.last_error ?? null,
  push_error: row?.push_error ?? null,
  slots: row?.slots ?? 0,
});

// The person's own events at the provider: with titles, busy or free.
async function readGoogle(token: string) {
  const now = new Date();
  return listOwnEvents(token, now, new Date(now.getTime() + EXTERNAL_DAYS * 24 * 60 * 60 * 1000));
}

// One connection is read again and its slots replaced. A failure keeps the old slots
// (those already over drop out when read) and remembers the reason.
export async function refreshOne(admin: SupabaseClient, row: Connection): Promise<Connection> {
  const key = { workspace_id: row.workspace_id, user_id: row.user_id };
  const now = new Date().toISOString();
  let patch: Partial<Connection>;
  try {
    const slots = row.kind === "google" ? await readGoogle(decrypt(row.token_encrypted ?? "")) : await readBusy(decrypt(row.url_encrypted ?? ""));
    const kept = await writeBusy(admin, row.workspace_id, row.user_id, slots);
    patch = kept === null ? { checked_at: now, last_error: "not_ready" } : { checked_at: now, synced_at: now, last_error: null, slots: kept };
  } catch (error) {
    patch = { checked_at: now, last_error: reasonOf(error) };
  }
  await admin.from("calendar_connections").update(patch).match(key);
  return { ...row, ...patch };
}

export async function connectionState(workspaceId: string, userId: string): Promise<ConnectionState> {
  const admin = createAdminClient();
  if (!admin || !externalCalendarsConfigured()) return NOT_CONFIGURED;
  const { data } = await admin.from("calendar_connections").select(COLUMNS).match({ workspace_id: workspaceId, user_id: userId }).maybeSingle();
  return stateOf(data as Connection | null);
}

// A new address: it must be a calendar right now, or nothing is saved.
export async function connectCalendar(workspaceId: string, userId: string, rawUrl: string): Promise<{ ok: true; state: ConnectionState } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!admin || !externalCalendarsConfigured()) return { ok: false, error: "not_configured" };
  // A sign-in in place stays until it is disconnected on purpose.
  const { data: current } = await admin.from("calendar_connections").select("kind").match({ workspace_id: workspaceId, user_id: userId }).maybeSingle();
  if (current?.kind === "google") return { ok: false, error: "google_connected" };
  const url = normalizeCalendarUrl(rawUrl);
  if (url.length > 2000 || !checkUrl(url)) return { ok: false, error: "bad_url" };
  let slots: BusySlotInput[];
  try {
    slots = await readBusy(url);
  } catch (error) {
    return { ok: false, error: reasonOf(error) };
  }
  const kept = await writeBusy(admin, workspaceId, userId, slots);
  if (kept === null) return { ok: false, error: "not_ready" };
  const now = new Date().toISOString();
  const row: Connection = {
    workspace_id: workspaceId,
    user_id: userId,
    kind: "feed",
    url_encrypted: encryptCalendar(url),
    token_encrypted: null,
    account_email: null,
    doba_calendar_id: null,
    checked_at: now,
    synced_at: now,
    last_error: null,
    slots: kept,
    pushed_at: null,
    push_error: null,
  };
  const { error } = await admin.from("calendar_connections").upsert(row, { onConflict: "workspace_id,user_id" });
  if (error) {
    await writeBusy(admin, workspaceId, userId, []);
    return { ok: false, error: "unknown" };
  }
  return { ok: true, state: stateOf(row) };
}

// The address and every slot go at once (a sign-in: src/lib/calendar-google.ts).
export async function disconnectCalendar(workspaceId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.from("calendar_connections").delete().match({ workspace_id: workspaceId, user_id: userId, kind: "feed" });
  if (error) return false;
  return (await writeBusy(admin, workspaceId, userId, [])) !== null;
}

// "Refresh now": the person's own connection, at most once a minute.
export async function refreshNow(workspaceId: string, userId: string): Promise<ConnectionState> {
  const admin = createAdminClient();
  if (!admin || !externalCalendarsConfigured()) return NOT_CONFIGURED;
  const [row] = await claim(admin, RETRY_MS, { workspaceId, userIds: [userId] });
  if (row) return stateOf(await refreshOne(admin, row));
  return connectionState(workspaceId, userId);
}

// Takes the connections not tried for `olderThanMs` and stamps them in the same step,
// so two requests at once never read the same calendar twice.
async function claim(admin: SupabaseClient, olderThanMs: number, only: { workspaceId: string; userIds: string[] }): Promise<Connection[]> {
  const before = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await admin
    .from("calendar_connections")
    .update({ checked_at: new Date().toISOString() })
    .eq("workspace_id", only.workspaceId)
    .in("user_id", only.userIds)
    .or(`checked_at.is.null,checked_at.lt.${before}`)
    .select(COLUMNS);
  return (data ?? []) as Connection[];
}

// Stale-while-revalidate: called after a response has gone out. Whoever of these people
// has a connection older than an hour gets it read again; the next look shows it.
export async function refreshStale(workspaceId: string, userIds: string[]): Promise<void> {
  const admin = createAdminClient();
  if (!admin || !externalCalendarsConfigured() || !userIds.length) return;
  const rows = await claim(admin, EXTERNAL_REFRESH_MS, { workspaceId, userIds: userIds.slice(0, 50) });
  for (const row of rows) await refreshOne(admin, row).catch(() => {});
}

// The daily run: every connection not tried for an hour, a bounded number per run.
export async function refreshAllStale(admin: SupabaseClient, max = 200): Promise<{ refreshed: number; failed: number }> {
  if (!externalCalendarsConfigured()) return { refreshed: 0, failed: 0 };
  const result = { refreshed: 0, failed: 0 };
  const deadline = Date.now() + 40_000;
  while (result.refreshed + result.failed < max && Date.now() < deadline) {
    const before = new Date(Date.now() - EXTERNAL_REFRESH_MS).toISOString();
    const { data: due } = await admin
      .from("calendar_connections")
      .select("workspace_id, user_id")
      .or(`checked_at.is.null,checked_at.lt.${before}`)
      .order("checked_at", { ascending: true, nullsFirst: true })
      .limit(10);
    if (!due?.length) break;
    const done = result.refreshed + result.failed;
    for (const one of due) {
      const [row] = await claim(admin, EXTERNAL_REFRESH_MS, { workspaceId: one.workspace_id, userIds: [one.user_id] });
      if (!row) continue;
      const after = await refreshOne(admin, row).catch(() => null);
      if (after && !after.last_error) result.refreshed += 1;
      else result.failed += 1;
    }
    // Nothing could be taken (someone else has them): no point in asking again.
    if (result.refreshed + result.failed === done) break;
  }
  return result;
}
