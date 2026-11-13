import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { busyStore, COLUMNS, externalCalendarsConfigured, refreshOne, writeBusy, type Connection } from "@/lib/calendar-external";
import { decrypt, encryptCalendar } from "@/lib/drive/secret-box";
import {
  createCalendar,
  createMeeting,
  deleteCalendar,
  deleteCopy,
  exchangeCode,
  GoogleCalendarError,
  googleCalendarConfigured,
  insertCopy,
  revoke,
  updateCopy,
  type CopyBody,
} from "@/lib/google-calendar";
import { createAdminClient } from "@/lib/supabase/admin";

// DOBA-1 (phase 3c, decisions 2027-02-01 and 2026-11-13): a person's calendar connected by
// signing in with the provider.
// - Their own events are read with titles (src/lib/calendar-external.ts, refreshOne).
// - Their Doba events are copied into the app's own "Doba" calendar there: each day of a
//   series on its own, no descriptions, a day back and 90 days ahead; changes go out right
//   after they are made, and once a day for everyone (copies of what is over stay).
// - A video meeting room can be made for an event's meeting link.
// - Disconnecting (or leaving the workspace) takes the access back at the provider.
// The access is encrypted with CALENDAR_TOKEN_KEY, in the central database only, never in
// the browser, a backup, "My data" or a log.

export const PUSH_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
// One person's copies are not written by two requests at once.
const PUSH_LOCK_MS = 45_000;
// Calls to the provider per person and run (the rest follows next time).
const MAX_CALLS = 120;

export const googleReady = () => externalCalendarsConfigured() && googleCalendarConfigured() && (process.env.DRIVE_TOKEN_KEY ?? "").length >= 24;

const tokenOf = (row: Connection) => decrypt(row.token_encrypted ?? "");

// --- Connecting ---------------------------------------------------------------------

// The code from the consent screen: the access is kept, the "Doba" calendar created, the
// person's events read and their Doba events copied. A feed address in place is replaced.
export async function finishConnect(
  workspaceId: string,
  userId: string,
  code: string,
  redirectUri: string,
  timeZone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!admin || !googleReady()) return { ok: false, error: "not_configured" };
  let access: { refreshToken: string; email: string };
  try {
    access = await exchangeCode(code, redirectUri);
  } catch (error) {
    return { ok: false, error: error instanceof GoogleCalendarError && error.status === 412 ? "permissions" : "unknown" };
  }
  // An earlier sign-in (a second tab, say) goes first, with its calendar and access.
  const { data: before } = await admin.from("calendar_connections").select(COLUMNS).match({ workspace_id: workspaceId, user_id: userId }).maybeSingle();
  if ((before as Connection | null)?.kind === "google") await forget(admin, before as Connection, true);

  let calendarId: string;
  try {
    calendarId = await createCalendar(access.refreshToken, "Doba", timeZone);
  } catch {
    await takeBack(admin, access.email, access.refreshToken);
    return { ok: false, error: "unknown" };
  }
  const row: Connection = {
    workspace_id: workspaceId,
    user_id: userId,
    kind: "google",
    url_encrypted: null,
    token_encrypted: encryptCalendar(access.refreshToken),
    account_email: access.email.slice(0, 320) || null,
    doba_calendar_id: calendarId,
    checked_at: null,
    synced_at: null,
    last_error: null,
    slots: 0,
    pushed_at: null,
    push_error: null,
  };
  const { error } = await admin.from("calendar_connections").upsert(row, { onConflict: "workspace_id,user_id" });
  if (error) {
    await deleteCalendar(access.refreshToken, calendarId).catch(() => {});
    await takeBack(admin, access.email, access.refreshToken);
    return { ok: false, error: "unknown" };
  }
  // A feed's slots are replaced by the first reading.
  await refreshOne(admin, { ...row, checked_at: new Date().toISOString() }).catch(() => {});
  return { ok: true };
}

// The access goes back to the provider unless the same account also keeps a workspace's
// files (taking it back there could cut that off too); either way nothing of it stays here.
async function takeBack(admin: SupabaseClient, accountEmail: string | null, token: string): Promise<void> {
  const email = (accountEmail ?? "").toLowerCase();
  if (email) {
    const { data: drives } = await admin.from("drive_connections").select("account_email").eq("active", true).ilike("account_email", email).limit(1);
    if (drives?.length) return;
  }
  await revoke(token).catch(() => {});
}

// Disconnecting: optionally the "Doba" calendar at the provider, then the access, the
// connection with its links, and the person's outside events here.
async function forget(admin: SupabaseClient, row: Connection, removeCalendar: boolean): Promise<boolean> {
  let token = "";
  try {
    token = tokenOf(row);
  } catch {
    // An unreadable access can't be taken back; it is still removed here.
  }
  if (token && removeCalendar && row.doba_calendar_id) await deleteCalendar(token, row.doba_calendar_id).catch(() => {});
  if (token) await takeBack(admin, row.account_email, token);
  const { error } = await admin.from("calendar_connections").delete().match({ workspace_id: row.workspace_id, user_id: row.user_id, kind: "google" });
  if (error) return false;
  await writeBusy(admin, row.workspace_id, row.user_id, []);
  return true;
}

export async function disconnectGoogle(workspaceId: string, userId: string, removeCalendar: boolean): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { data } = await admin.from("calendar_connections").select(COLUMNS).match({ workspace_id: workspaceId, user_id: userId, kind: "google" }).maybeSingle();
  if (!data) return true;
  return forget(admin, data as Connection, removeCalendar);
}

// --- Video meetings -----------------------------------------------------------------

export async function newMeeting(workspaceId: string, userId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!admin || !googleReady()) return { ok: false, error: "not_configured" };
  const { data } = await admin.from("calendar_connections").select(COLUMNS).match({ workspace_id: workspaceId, user_id: userId, kind: "google" }).maybeSingle();
  if (!data) return { ok: false, error: "not_connected" };
  try {
    return { ok: true, url: await createMeeting(tokenOf(data as Connection)) };
  } catch (error) {
    return { ok: false, error: error instanceof GoogleCalendarError && error.revoked ? "revoked" : "unknown" };
  }
}

// --- Copies of Doba events ------------------------------------------------------------

type PersonEvent = {
  id: string;
  title: string;
  location: string | null;
  meeting_url: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  occurrence: string | null;
  status: string;
};
type Link = { item: string; event_id: string; remote_id: string; fingerprint: string; starts_at: string };

const itemOf = (e: PersonEvent) => (e.occurrence ? `${e.id}/${e.occurrence}` : e.id);

export function copyOf(e: PersonEvent): CopyBody {
  const time = (iso: string) => (e.all_day ? { date: iso.slice(0, 10) } : { dateTime: new Date(iso).toISOString() });
  return {
    summary: e.title || "—",
    ...(e.location ? { location: e.location } : {}),
    ...(e.meeting_url ? { description: e.meeting_url } : {}),
    start: time(e.starts_at),
    end: time(e.ends_at),
    status: e.status === "accepted" ? "confirmed" : "tentative",
    transparency: "opaque",
    extendedProperties: { private: { doba: itemOf(e) } },
  };
}

const fingerprintOf = (body: CopyBody) => createHash("sha256").update(JSON.stringify(body)).digest("base64url");

// Takes the person's connection for writing, so two requests never copy at once.
async function claimPush(admin: SupabaseClient, workspaceId: string, userId: string): Promise<Connection | null> {
  const before = new Date(Date.now() - PUSH_LOCK_MS).toISOString();
  const { data } = await admin
    .from("calendar_connections")
    .update({ pushed_at: new Date().toISOString() })
    .match({ workspace_id: workspaceId, user_id: userId, kind: "google" })
    .or(`pushed_at.is.null,pushed_at.lt.${before}`)
    .select(COLUMNS);
  return ((data ?? [])[0] as Connection | undefined) ?? null;
}

// One person's "Doba" calendar is brought in line with their Doba events.
async function pushOne(admin: SupabaseClient, row: Connection): Promise<void> {
  const key = { workspace_id: row.workspace_id, user_id: row.user_id };
  const fail = (code: string) => admin.from("calendar_connections").update({ push_error: code }).match(key);
  const store = await busyStore(admin, row.workspace_id);
  if (!store || !row.doba_calendar_id) {
    await fail("not_ready");
    return;
  }
  const from = new Date(Date.now() - DAY);
  const to = new Date(Date.now() + PUSH_DAYS * DAY);
  const { data, error } = await store.rpc("calendar_person_events", { ws: row.workspace_id, person: row.user_id, range_from: from.toISOString(), range_to: to.toISOString() });
  if (error) {
    await fail("not_ready");
    return;
  }
  // No longer an active member: the access goes back and the connection with it.
  if (data === null) {
    await forget(admin, row, false);
    return;
  }
  const wanted = new Map((data as PersonEvent[]).map((e) => [itemOf(e), e]));
  const { data: linkRows } = await admin.from("calendar_external_links").select("item, event_id, remote_id, fingerprint, starts_at").match(key).limit(5000);
  const links = new Map(((linkRows ?? []) as Link[]).map((l) => [l.item, l]));
  const token = tokenOf(row);
  const calendar = row.doba_calendar_id;
  let calls = 0;
  try {
    for (const [item, event] of wanted) {
      if (calls >= MAX_CALLS) break;
      const body = copyOf(event);
      const fingerprint = fingerprintOf(body);
      const link = links.get(item);
      if (link?.fingerprint === fingerprint) continue;
      calls += 1;
      let remoteId = link?.remote_id ?? null;
      if (remoteId) {
        try {
          await updateCopy(token, calendar, remoteId, body);
        } catch (e) {
          if (!(e instanceof GoogleCalendarError && e.gone)) throw e;
          remoteId = null;
        }
      }
      if (!remoteId) remoteId = await insertCopy(token, calendar, body);
      await admin
        .from("calendar_external_links")
        .upsert({ ...key, item, event_id: event.id, remote_id: remoteId, fingerprint, starts_at: event.starts_at, synced_at: new Date().toISOString() }, { onConflict: "workspace_id,user_id,item" });
    }
    // What is no longer theirs (cancelled, declined, moved away) goes; copies of what is
    // over stay as they are, and their links are forgotten after a month.
    for (const link of links.values()) {
      if (wanted.has(link.item)) continue;
      if (Date.parse(link.starts_at) < from.getTime()) continue;
      if (calls >= MAX_CALLS) break;
      calls += 1;
      await deleteCopy(token, calendar, link.remote_id);
      await admin.from("calendar_external_links").delete().match({ ...key, item: link.item });
    }
    await admin.from("calendar_external_links").delete().match(key).lt("starts_at", new Date(Date.now() - 30 * DAY).toISOString());
    await admin.from("calendar_connections").update({ push_error: calls >= MAX_CALLS ? "partial" : null }).match(key);
  } catch (e) {
    // The "Doba" calendar was deleted at the provider: a new one, copied in full next time.
    if (e instanceof GoogleCalendarError && e.gone) {
      const id = await createCalendar(token, "Doba", "UTC").catch(() => null);
      await admin.from("calendar_external_links").delete().match(key);
      await admin.from("calendar_connections").update({ doba_calendar_id: id ?? row.doba_calendar_id, push_error: "recreated", pushed_at: null }).match(key);
      return;
    }
    await fail(e instanceof GoogleCalendarError && e.revoked ? "revoked" : "unreachable");
  }
}

// After a change to events in a workspace: everyone there with a sign-in, now. Someone
// being copied right now is tried again a little later.
export async function pushWorkspace(workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin || !googleReady()) return;
  const { data } = await admin.from("calendar_connections").select("user_id").match({ workspace_id: workspaceId, kind: "google" }).limit(50);
  let waiting = (data ?? []).map((r) => r.user_id as string);
  for (let round = 0; round < 3 && waiting.length; round += 1) {
    if (round) await new Promise((r) => setTimeout(r, 15_000));
    const next: string[] = [];
    for (const userId of waiting) {
      const row = await claimPush(admin, workspaceId, userId);
      if (row) await pushOne(admin, row).catch(() => {});
      else next.push(userId);
    }
    waiting = next;
  }
}

// The daily run: every sign-in not copied for half a day, a bounded number per run.
export async function pushAllStale(admin: SupabaseClient, max = 100): Promise<{ pushed: number }> {
  if (!googleReady()) return { pushed: 0 };
  const before = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("calendar_connections")
    .select("workspace_id, user_id")
    .eq("kind", "google")
    .or(`pushed_at.is.null,pushed_at.lt.${before}`)
    .order("pushed_at", { ascending: true, nullsFirst: true })
    .limit(max);
  let pushed = 0;
  const deadline = Date.now() + 40_000;
  for (const one of data ?? []) {
    if (Date.now() > deadline) break;
    const row = await claimPush(admin, one.workspace_id as string, one.user_id as string);
    if (!row) continue;
    await pushOne(admin, row).catch(() => {});
    pushed += 1;
  }
  return { pushed };
}
